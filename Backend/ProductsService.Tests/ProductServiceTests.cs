using System.Globalization;
using Microsoft.EntityFrameworkCore;
using OmniConnect.Validation;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Application.Interfaces;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Domain.Enums;
using ProductMarketplace.Infrastructure.Data;
using ProductMarketplace.Infrastructure.Services;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// Products: what may be saved, what is stored, and how the catalogue finds them again.
/// </summary>
/// <remarks>
/// <para>
/// The old service stored whatever it was sent. A field marked Required could be left empty, a "rate"
/// could be the word "high", a dropdown could hold a value that was never an option, and a value for a
/// field of some other product type was quietly dropped — the forms enforced most of it and a request
/// that skipped the form enforced none. Numbers were also parsed with the server's culture, so "8.35"
/// was 835 on a machine set to a comma-decimal locale. These pin the replacement: every rule the
/// sub-category defines is held to on the server, every failing field is reported together, and numbers
/// mean the same thing everywhere.
/// </para>
/// <para>
/// The catalogue queries are pinned too — including that paging walks every product exactly once, which
/// only holds while the sort has a stable tiebreaker.
/// </para>
/// </remarks>
public class ProductServiceTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;

    public ProductServiceTests() => catalogue = new Catalogue(db);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<SubCategory> LoanAsync()
    {
        await catalogue.SeedStatusesAsync();
        var category = await catalogue.AddCategoryAsync();
        return await catalogue.AddSubCategoryAsync(category);
    }

    private async Task<FieldDefinition> AddFieldAsync(SubCategory sub, string key, FieldDataType type, Action<FieldDefinition>? configure = null)
    {
        var field = new FieldDefinition { SubCategoryId = sub.Id, Key = key, Label = key.Replace('_', ' '), DataType = type, SortOrder = db.FieldDefinitions.Count() + 1 };
        configure?.Invoke(field);
        db.FieldDefinitions.Add(field);
        await db.SaveChangesAsync();
        return field;
    }

    private static ProductCreateUpdateDto Product(SubCategory sub, params (FieldDefinition Field, string Value)[] values) => Product(sub, "HL_001", values);

    private static ProductCreateUpdateDto Product(SubCategory sub, string code, params (FieldDefinition Field, string Value)[] values) => new()
    {
        SubCategoryId = sub.Id,
        Name = "Home Loan – Salaried",
        Code = code,
        FieldValues = values.Select(v => new ProductFieldValueInputDto { FieldDefinitionId = v.Field.Id, Value = v.Value }).ToList(),
    };

    private async Task<FieldValidationException> RefusedAsync(ProductCreateUpdateDto dto, IFormatPresetSource? presets = null) =>
        await Assert.ThrowsAsync<FieldValidationException>(() => catalogue.Products(presets).CreateAsync(dto));

    // ---------------------------------------------------------------- attribute values

    [Fact]
    public async Task A_required_field_left_empty_is_refused_naming_the_field()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "interest_rate", FieldDataType.Percentage, f => f.Required = true);

        var error = await RefusedAsync(Product(sub, (rate, "  ")));

        Assert.Equal("interest rate is required.", error.Errors["interest_rate"]);
    }

    [Fact]
    public async Task A_required_field_that_is_missing_altogether_is_refused_too()
    {
        var sub = await LoanAsync();
        await AddFieldAsync(sub, "interest_rate", FieldDataType.Percentage, f => f.Required = true);

        var error = await RefusedAsync(Product(sub));

        Assert.Contains("interest_rate", error.Errors.Keys);
    }

    /// <summary>A form that reports one problem per submit makes a person find the next one on the following try.</summary>
    [Fact]
    public async Task Every_failing_field_is_reported_together_not_the_first_only()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "rate", FieldDataType.Number);
        var flag = await AddFieldAsync(sub, "insured", FieldDataType.Boolean);
        await AddFieldAsync(sub, "term", FieldDataType.Text, f => f.Required = true);

        var error = await RefusedAsync(Product(sub, (rate, "high"), (flag, "maybe")));

        Assert.Equal(["insured", "rate", "term"], error.Errors.Keys.Order());
        Assert.Contains("3 fields need attention", error.Message);
    }

    [Fact]
    public async Task A_number_field_holds_a_number()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "rate", FieldDataType.Number);

        var error = await RefusedAsync(Product(sub, (rate, "eight")));

        Assert.Equal("rate must be a number.", error.Errors["rate"]);
    }

    /// <summary>The old parse used the server's culture: "8.35" was 835 under a comma-decimal locale.</summary>
    [Fact]
    public async Task A_number_means_the_same_thing_whatever_the_servers_culture()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "rate", FieldDataType.Percentage);
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");

            var created = await catalogue.Products().CreateAsync(Product(sub, (rate, "8.35")));

            Assert.Equal(8.35m, (await db.ProductFieldValues.AsNoTracking().SingleAsync(v => v.ProductId == created.Id)).NumericValue);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public async Task A_dropdown_accepts_an_option_in_any_case_and_stores_it_as_the_definition_spells_it()
    {
        var sub = await LoanAsync();
        var tenure = await AddFieldAsync(sub, "tenure", FieldDataType.Dropdown, f => f.OptionsJson = "[\"1 year\",\"5 years\"]");

        var created = await catalogue.Products().CreateAsync(Product(sub, (tenure, "5 YEARS")));

        Assert.Equal("5 years", (await db.ProductFieldValues.AsNoTracking().SingleAsync(v => v.ProductId == created.Id)).Value);
    }

    [Fact]
    public async Task A_dropdown_refuses_a_value_that_is_not_an_option_and_lists_the_ones_that_are()
    {
        var sub = await LoanAsync();
        var tenure = await AddFieldAsync(sub, "tenure", FieldDataType.Dropdown, f => f.OptionsJson = "[\"1 year\",\"5 years\"]");

        var error = await RefusedAsync(Product(sub, (tenure, "10 years")));

        Assert.Equal("tenure must be one of: 1 year, 5 years.", error.Errors["tenure"]);
    }

    [Fact]
    public async Task A_multi_select_is_stored_as_its_canonical_options_without_repeats()
    {
        var sub = await LoanAsync();
        var perks = await AddFieldAsync(sub, "perks", FieldDataType.MultiSelect, f => f.OptionsJson = "[\"Lounge\",\"Insurance\",\"Cashback\"]");

        var created = await catalogue.Products().CreateAsync(Product(sub, (perks, "lounge, CASHBACK ,lounge")));

        Assert.Equal("Lounge, Cashback", (await db.ProductFieldValues.AsNoTracking().SingleAsync(v => v.ProductId == created.Id)).Value);
        var error = await RefusedAsync(Product(sub, "HL_002", (perks, "Lounge, Spa")));
        Assert.Contains("\"Spa\" is not an option", error.Errors["perks"]);
    }

    [Fact]
    public async Task A_boolean_is_stored_as_true_or_false()
    {
        var sub = await LoanAsync();
        var insured = await AddFieldAsync(sub, "insured", FieldDataType.Boolean);

        var created = await catalogue.Products().CreateAsync(Product(sub, (insured, "TRUE")));

        Assert.Equal("true", (await db.ProductFieldValues.AsNoTracking().SingleAsync(v => v.ProductId == created.Id)).Value);
    }

    [Fact]
    public async Task A_date_field_holds_a_date()
    {
        var sub = await LoanAsync();
        var launch = await AddFieldAsync(sub, "launch", FieldDataType.Date);

        Assert.Equal("launch must be a date.", (await RefusedAsync(Product(sub, (launch, "next spring")))).Errors["launch"]);
        Assert.NotNull(await catalogue.Products().CreateAsync(Product(sub, "HL_002", (launch, "2026-10-01"))));
    }

    [Fact]
    public async Task An_optional_field_left_blank_stores_nothing()
    {
        var sub = await LoanAsync();
        var note = await AddFieldAsync(sub, "note", FieldDataType.Text);

        var created = await catalogue.Products().CreateAsync(Product(sub, (note, "")));

        Assert.Empty(await db.ProductFieldValues.Where(v => v.ProductId == created.Id).ToListAsync());
    }

    [Fact]
    public async Task A_value_for_a_field_of_another_sub_category_is_refused_not_quietly_dropped()
    {
        var sub = await LoanAsync();
        var elsewhere = await catalogue.AddSubCategoryAsync(await db.Categories.SingleAsync(), "Car Loan", "LN-CR", order: 2);
        var foreign = await AddFieldAsync(elsewhere, "mileage", FieldDataType.Number);

        var error = await RefusedAsync(Product(sub, (foreign, "5")));

        Assert.Equal("This field does not belong to the sub-category the product is in.", error.Errors[foreign.Id.ToString()]);
    }

    [Fact]
    public async Task The_same_field_given_twice_is_refused()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "rate", FieldDataType.Number);

        var error = await RefusedAsync(Product(sub, (rate, "1"), (rate, "2")));

        Assert.Contains("more than once", error.Errors["rate"]);
    }

    // ---------------------------------------------------------------- format rules

    [Fact]
    public async Task A_fields_format_rules_are_evaluated_by_the_shared_engine()
    {
        var sub = await LoanAsync();
        var code = await AddFieldAsync(sub, "scheme_code", FieldDataType.Text,
            f => f.ValidationsJson = "[{\"type\":\"custom\",\"pattern\":\"^[A-Z]{3}[0-9]{2}$\",\"message\":\"Use three letters and two digits.\"}]");

        var error = await RefusedAsync(Product(sub, (code, "abc1")));

        Assert.Equal("Use three letters and two digits.", error.Errors["scheme_code"]);
        Assert.NotNull(await catalogue.Products().CreateAsync(Product(sub, "HL_002", (code, "ABC12"))));
    }

    [Fact]
    public async Task A_built_in_format_such_as_PAN_is_enforced_by_name()
    {
        var sub = await LoanAsync();
        var pan = await AddFieldAsync(sub, "pan", FieldDataType.Text, f => f.ValidationsJson = "[{\"type\":\"panFormat\",\"message\":\"Not a PAN.\"}]");

        Assert.Equal("Not a PAN.", (await RefusedAsync(Product(sub, (pan, "12345")))).Errors["pan"]);
        Assert.NotNull(await catalogue.Products().CreateAsync(Product(sub, "HL_002", (pan, "ABCDE1234F"))));
    }

    [Fact]
    public async Task A_format_defined_in_Manage_Formats_is_applied_by_its_key()
    {
        var sub = await LoanAsync();
        var field = await AddFieldAsync(sub, "branch_code", FieldDataType.Text, f => f.ValidationsJson = "[{\"type\":\"twoDigits\",\"message\":\"Two digits only.\"}]");
        var presets = new FixedPresets(new FormatPreset("twoDigits", "Two digits", FieldPresets.CustomPresetKindRegex, "^[0-9]{2}$", null, null, null, null, "Two digits only."));

        Assert.Equal("Two digits only.", (await RefusedAsync(Product(sub, (field, "123")), presets)).Errors["branch_code"]);
        Assert.NotNull(await catalogue.Products(presets).CreateAsync(Product(sub, "HL_002", (field, "12"))));
    }

    /// <summary>A format renamed or deleted in Manage Formats must not make every product impossible to save.</summary>
    [Fact]
    public async Task A_rule_naming_a_format_that_no_longer_exists_fails_open()
    {
        var sub = await LoanAsync();
        var field = await AddFieldAsync(sub, "branch_code", FieldDataType.Text, f => f.ValidationsJson = "[{\"type\":\"deletedFormat\",\"message\":\"Nope.\"}]");

        Assert.NotNull(await catalogue.Products().CreateAsync(Product(sub, (field, "anything at all"))));
    }

    [Fact]
    public async Task A_corrupt_stored_rule_reads_as_no_rules_rather_than_blocking_every_product()
    {
        var sub = await LoanAsync();
        var field = await AddFieldAsync(sub, "note", FieldDataType.Text, f => f.ValidationsJson = "{not json");

        Assert.NotNull(await catalogue.Products().CreateAsync(Product(sub, (field, "fine"))));
    }

    // ---------------------------------------------------------------- create / update / delete

    [Fact]
    public async Task A_new_product_starts_as_the_default_status_from_Setup_which_is_not_live()
    {
        var sub = await LoanAsync();

        var created = await catalogue.Products().CreateAsync(Product(sub));

        Assert.Equal("Draft", created.Status);
        Assert.False(created.IsVisible);
    }

    [Fact]
    public async Task A_created_product_carries_where_it_sits_and_its_benefits_in_order()
    {
        var sub = await LoanAsync();
        var dto = Product(sub);
        dto.Status = "Active";
        dto.Benefits = [new() { Title = "Low rate" }, new() { Title = " " }, new() { Title = "Flexible tenure" }];

        var created = await catalogue.Products().CreateAsync(dto);

        Assert.Equal(("Loans", "Home Loan", "LN-HM"), (created.CategoryName, created.SubCategoryName, created.SubCategoryCode));
        Assert.Equal(["Low rate", "Flexible tenure"], created.FeatureTags);
        Assert.True(created.IsVisible);
    }

    [Fact]
    public async Task A_product_needs_a_sub_category_that_exists()
    {
        await catalogue.SeedStatusesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            catalogue.Products().CreateAsync(new ProductCreateUpdateDto { SubCategoryId = Guid.NewGuid(), Name = "Home Loan", Code = "HL_001" }));

        Assert.Contains("existing sub-category", error.Message);
    }

    [Fact]
    public async Task A_code_is_stored_upper_case_and_cannot_be_used_twice()
    {
        var sub = await LoanAsync();
        var created = await catalogue.Products().CreateAsync(Product(sub, "hl_001"));

        Assert.Equal("HL_001", created.Code);
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Products().CreateAsync(Product(sub, "HL_001")));
        Assert.Contains("already exists", error.Message);
    }

    [Fact]
    public async Task A_status_Setup_does_not_know_is_refused()
    {
        var sub = await LoanAsync();
        var dto = Product(sub);
        dto.Status = "Archived";

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Products().CreateAsync(dto));

        Assert.Contains("'Archived' is not a valid status for Product", error.Message);
    }

    [Fact]
    public async Task An_update_replaces_the_values_and_moving_to_another_sub_category_drops_the_old_ones()
    {
        var home = await LoanAsync();
        var car = await catalogue.AddSubCategoryAsync(await db.Categories.SingleAsync(), "Car Loan", "LN-CR", order: 2);
        var homeRate = await AddFieldAsync(home, "rate", FieldDataType.Number);
        var carRate = await AddFieldAsync(car, "car_rate", FieldDataType.Number);
        var created = await catalogue.Products().CreateAsync(Product(home, (homeRate, "8.5")));

        var moved = Product(car, "HL_001", (carRate, "9.25"));
        var updated = await catalogue.Products().UpdateAsync(created.Id, moved);

        Assert.Equal("Car Loan", updated!.SubCategoryName);
        var stored = await db.ProductFieldValues.AsNoTracking().Where(v => v.ProductId == created.Id).ToListAsync();
        Assert.Equal([carRate.Id], stored.Select(v => v.FieldDefinitionId));
        Assert.Equal(9.25m, stored.Single().NumericValue);
    }

    [Fact]
    public async Task A_product_can_be_saved_again_under_its_own_code_but_not_another_products()
    {
        var sub = await LoanAsync();
        var first = await catalogue.Products().CreateAsync(Product(sub, "HL_001"));
        await catalogue.Products().CreateAsync(Product(sub, "HL_002"));

        Assert.NotNull(await catalogue.Products().UpdateAsync(first.Id, Product(sub, "HL_001")));
        await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.Products().UpdateAsync(first.Id, Product(sub, "HL_002")));
    }

    [Fact]
    public async Task Updating_or_deleting_a_product_that_does_not_exist_reports_nothing_found()
    {
        var sub = await LoanAsync();

        Assert.Null(await catalogue.Products().UpdateAsync(Guid.NewGuid(), Product(sub)));
        Assert.Null(await catalogue.Products().UpdateStatusAsync(Guid.NewGuid(), "Active"));
        Assert.False(await catalogue.Products().DeleteAsync(Guid.NewGuid()));
    }

    [Fact]
    public async Task A_status_change_is_stored_as_Setup_spells_it_and_audited_with_before_and_after()
    {
        var (_, _, product) = await LiveChainAsync();

        var updated = await catalogue.Products().UpdateStatusAsync(product.Id, "inactive");

        Assert.Equal("Inactive", updated!.Status);
        var audit = await db.AuditLogs.SingleAsync(a => a.Action == AuditActions.ProductStatusChange);
        Assert.Equal(("Active", "Inactive"), (audit.PreviousValue, audit.NewValue));
    }

    [Fact]
    public async Task Deleting_a_product_removes_it()
    {
        var (_, _, product) = await LiveChainAsync();

        Assert.True(await catalogue.Products().DeleteAsync(product.Id));

        Assert.Null(await catalogue.Products().GetByIdAsync(product.Id, trackView: false));
        Assert.Contains(await db.AuditLogs.ToListAsync(), a => a.Action == AuditActions.DeleteProduct);
    }

    private async Task<(Category, SubCategory, Product)> LiveChainAsync()
    {
        await catalogue.SeedStatusesAsync();
        return await catalogue.AddLiveChainAsync();
    }

    // ---------------------------------------------------------------- finding products

    [Fact]
    public async Task Search_matches_name_code_short_description_and_where_the_product_sits_but_not_the_long_description()
    {
        var (_, sub, _) = await LiveChainAsync();
        db.Products.Add(new Product { SubCategoryId = sub.Id, Name = "Balance Transfer", Code = "BT_1", ShortDescription = "Move your loan", Description = "mentions zebra somewhere deep", Status = "Active" });
        await db.SaveChangesAsync();
        var products = catalogue.Products();

        Assert.Equal(["BT_1"], (await products.SearchAsync(new ProductQueryDto { Search = "balance" })).Items.Select(p => p.Code));
        Assert.Equal(["BT_1"], (await products.SearchAsync(new ProductQueryDto { Search = "bt_1" })).Items.Select(p => p.Code));
        Assert.Equal(["BT_1"], (await products.SearchAsync(new ProductQueryDto { Search = "your loan" })).Items.Select(p => p.Code));
        Assert.Equal(2, (await products.SearchAsync(new ProductQueryDto { Search = "home loan" })).TotalCount);
        Assert.Equal(2, (await products.SearchAsync(new ProductQueryDto { Search = "loans" })).TotalCount);
        Assert.Empty((await products.SearchAsync(new ProductQueryDto { Search = "zebra" })).Items);
    }

    [Fact]
    public async Task Products_can_be_filtered_by_category_and_by_sub_category()
    {
        var (loans, home, _) = await LiveChainAsync();
        var car = await catalogue.AddSubCategoryAsync(loans, "Car Loan", "LN-CR", order: 2);
        await catalogue.AddProductAsync(car, "Car Loan – New", "CL_001");
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        var cashback = await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddProductAsync(cashback, "Cashback Card", "CC_001");
        var products = catalogue.Products();

        Assert.Equal(["CL_001", "HL_001"], (await products.SearchAsync(new ProductQueryDto { CategoryId = loans.Id, Sort = "name" })).Items.Select(p => p.Code).Order());
        Assert.Equal(["HL_001"], (await products.SearchAsync(new ProductQueryDto { SubCategoryId = home.Id })).Items.Select(p => p.Code));
        Assert.Equal(["CC_001"], (await products.SearchAsync(new ProductQueryDto { CategoryId = cards.Id })).Items.Select(p => p.Code));
    }

    [Fact]
    public async Task Products_sort_by_name_newest_and_oldest()
    {
        var (_, sub, _) = await LiveChainAsync();
        await catalogue.AddProductAsync(sub, "Alpha", "A_1", createdAt: DateTime.UtcNow.AddDays(-5));
        await catalogue.AddProductAsync(sub, "Zulu", "Z_1", createdAt: DateTime.UtcNow.AddDays(-10));
        var products = catalogue.Products();

        Assert.Equal(["Alpha", "Home Loan – Salaried", "Zulu"], (await products.SearchAsync(new ProductQueryDto { Sort = "name" })).Items.Select(p => p.Name));
        Assert.Equal(["Zulu", "Home Loan – Salaried", "Alpha"], (await products.SearchAsync(new ProductQueryDto { Sort = "-name" })).Items.Select(p => p.Name));
        Assert.Equal("Home Loan – Salaried", (await products.SearchAsync(new ProductQueryDto())).Items[0].Name);
        Assert.Equal("Zulu", (await products.SearchAsync(new ProductQueryDto { Sort = "oldest" })).Items[0].Name);
    }

    [Fact]
    public async Task Sorting_by_the_primary_metric_puts_products_without_one_last_either_way()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "rate", FieldDataType.Percentage, f => f.IsPrimaryMetric = true);
        await catalogue.Products().CreateAsync(Product(sub, "HI", (rate, "10.5")));
        await catalogue.Products().CreateAsync(Product(sub, "LO", (rate, "7.25")));
        await catalogue.Products().CreateAsync(Product(sub, "NONE"));
        var products = catalogue.Products();

        Assert.Equal(["LO", "HI", "NONE"], (await products.SearchAsync(new ProductQueryDto { Sort = "primary-metric" })).Items.Select(p => p.Code));
        Assert.Equal(["HI", "LO", "NONE"], (await products.SearchAsync(new ProductQueryDto { Sort = "-primary-metric" })).Items.Select(p => p.Code));
    }

    /// <summary>Only holds while the sort ends in a unique key: without one a product can land on two pages or none.</summary>
    [Fact]
    public async Task Paging_walks_every_product_exactly_once_even_when_they_tie_on_the_sort()
    {
        var (_, sub, _) = await LiveChainAsync();
        var sameInstant = DateTime.UtcNow;
        for (var i = 0; i < 22; i++) await catalogue.AddProductAsync(sub, $"Product {i:00}", $"P{i:00}", createdAt: sameInstant);

        var seen = new List<string>();
        for (var page = 1; page <= 3; page++)
        {
            var result = await catalogue.Products().SearchAsync(new ProductQueryDto { Page = page, PageSize = 10, Sort = "newest" });
            Assert.Equal(23, result.TotalCount);
            seen.AddRange(result.Items.Select(p => p.Code));
        }

        Assert.Equal(23, seen.Distinct().Count());
    }

    [Theory]
    [InlineData(0, 12)]
    [InlineData(-5, 12)]
    [InlineData(25, 25)]
    [InlineData(1_000_000, 100)]
    public void A_page_size_is_capped_and_a_nonsense_one_falls_back_to_the_lists_own_default(int requested, int expected)
    {
        Assert.Equal(expected, new ProductQueryDto { PageSize = requested }.PageSize);
    }

    [Fact]
    public void Every_list_reads_a_missing_page_size_as_its_own_default_and_a_page_below_one_as_the_first()
    {
        Assert.Equal(12, new ProductQueryDto().PageSize);
        Assert.Equal(10, new CategoryQueryDto().PageSize);
        Assert.Equal(10, new SubCategoryQueryDto().PageSize);
        Assert.Equal(1, new ProductQueryDto { Page = -3 }.Page);
        Assert.Equal(1, new CategoryQueryDto { Page = 0 }.Page);
    }

    [Fact]
    public async Task Status_counts_ignore_the_status_filter_but_honour_the_category()
    {
        var (loans, sub, _) = await LiveChainAsync();
        await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        var cashback = await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddProductAsync(cashback, "Cashback Card", "CC_001");

        var counts = await catalogue.Products().StatusCountsAsync(new ProductQueryDto { CategoryId = loans.Id, Status = "Draft" });

        Assert.Equal([new StatusCountDto("Active", 1), new StatusCountDto("Draft", 1)], counts);
    }

    /// <summary>The list loads only what a card shows. Pinned so narrowing the query never drops something a card displays.</summary>
    [Fact]
    public async Task A_product_card_carries_its_card_fields_in_order_and_its_benefit_titles()
    {
        var sub = await LoanAsync();
        var rate = await AddFieldAsync(sub, "rate", FieldDataType.Percentage, f => { f.DisplayOnCard = true; f.SortOrder = 2; f.Label = "Rate"; });
        var fee = await AddFieldAsync(sub, "fee", FieldDataType.Currency, f => { f.DisplayOnCard = true; f.SortOrder = 1; f.Label = "Fee"; });
        var hidden = await AddFieldAsync(sub, "internal", FieldDataType.Text, f => { f.DisplayOnCard = false; f.Label = "Internal"; });
        var dto = Product(sub, (rate, "3.5"), (fee, "500"), (hidden, "secret"));
        dto.Status = "Active";
        dto.Benefits = [new() { Title = "First" }, new() { Title = "Second" }, new() { Title = "Third" }];
        await catalogue.Products().CreateAsync(dto);

        var card = Assert.Single((await catalogue.Products().SearchAsync(new ProductQueryDto())).Items);

        Assert.Equal(["Fee", "Rate"], card.CardFields.Select(f => f.Label));
        Assert.Equal(["First", "Second", "Third"], card.FeatureTags);
        Assert.Equal("Loans", card.CategoryName);
        Assert.Equal("Home Loan", card.SubCategoryName);
    }

    [Fact]
    public async Task The_detail_carries_every_detail_field_benefits_and_eligibility()
    {
        var sub = await LoanAsync();
        var shown = await AddFieldAsync(sub, "tenure", FieldDataType.Text, f => f.DisplayOnDetails = true);
        var notShown = await AddFieldAsync(sub, "audit_note", FieldDataType.Text, f => f.DisplayOnDetails = false);
        var dto = Product(sub, (shown, "20 years"), (notShown, "x"));
        dto.EligibilityCriteria = [new() { Criteria = "Age 21–60", Description = "At application" }, new() { Criteria = "" }];
        dto.Benefits = [new() { Title = "Low rate", Description = "From 8.35%" }];
        var created = await catalogue.Products().CreateAsync(dto);

        var detail = (await catalogue.Products().GetByIdAsync(created.Id, trackView: false))!;

        Assert.Equal(["tenure"], detail.DetailFields.Select(f => f.Key));
        Assert.Equal("Age 21–60", Assert.Single(detail.EligibilityCriteria).Criteria);
        Assert.Equal("From 8.35%", Assert.Single(detail.Benefits).Description);
    }

    [Fact]
    public async Task The_download_lists_what_the_filters_match_and_reports_the_counts()
    {
        var (_, sub, _) = await LiveChainAsync();
        await catalogue.AddProductAsync(sub, "A draft", "HL_002", status: "Draft");

        var export = await catalogue.Products().ExportCsvAsync(new ProductQueryDto { Status = "Draft" });

        Assert.StartsWith("Product,Code,Category,Sub-category,Status,Views,Added (UTC)", export.Content);
        Assert.Contains("HL_002", export.Content);
        Assert.DoesNotContain("HL_001", export.Content);
        Assert.Equal((1, 1), (export.RowCount, export.MatchCount));
    }
}
