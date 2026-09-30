using Microsoft.EntityFrameworkCore;
using OmniConnect.Validation;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Domain.Entities;
using ProductMarketplace.Infrastructure.Data;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// Sub-categories — the kinds of product within a category — and the attributes each kind carries.
/// </summary>
/// <remarks>
/// <para>
/// This is the level that did not exist before: the old schema held a category tree whose children were
/// never shown, and a separate "product type" that carried the field definitions. A sub-category is both
/// now, so these tests pin what makes it worth having — a code that names one sub-category anywhere in
/// the catalogue, a name that only has to be unique inside its category, products that follow the
/// sub-category when it moves, and the rules that keep an attribute definition from being saved in a
/// state that could never work.
/// </para>
/// </remarks>
public class SubCategoryServiceTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;

    public SubCategoryServiceTests() => catalogue = new Catalogue(db);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static SubCategoryCreateUpdateDto Dto(Category category, string name, string code, string status = "", int order = 0) =>
        new() { CategoryId = category.Id, Name = name, Code = code, Status = status, DisplayOrder = order };

    private static FieldDefinitionCreateUpdateDto Field(string label, string type = "Text", Action<FieldDefinitionCreateUpdateDto>? configure = null)
    {
        var dto = new FieldDefinitionCreateUpdateDto { Label = label, DataType = type };
        configure?.Invoke(dto);
        return dto;
    }

    private async Task<(Category Category, SubCategory Sub)> ArrangeAsync()
    {
        await catalogue.SeedStatusesAsync();
        var category = await catalogue.AddCategoryAsync();
        return (category, await catalogue.AddSubCategoryAsync(category));
    }

    // ---------------------------------------------------------------- create / uniqueness

    [Fact]
    public async Task A_sub_category_belongs_to_a_category_that_exists()
    {
        await catalogue.SeedStatusesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            catalogue.SubCategories.CreateAsync(new SubCategoryCreateUpdateDto { CategoryId = Guid.NewGuid(), Name = "Home Loan", Code = "LN-HM" }));

        Assert.Contains("existing category", error.Message);
    }

    [Fact]
    public async Task A_new_sub_category_carries_its_category_and_the_default_status()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();

        var created = await catalogue.SubCategories.CreateAsync(Dto(loans, "Home Loan", " ln-hm "));

        Assert.Equal("LN-HM", created.Code);
        Assert.Equal("Loans", created.CategoryName);
        Assert.Equal("LN", created.CategoryCode);
        Assert.Equal("Active", created.Status);
        Assert.True(created.IsLive);
    }

    /// <summary>A code has to name one sub-category unambiguously in a report or on a lead.</summary>
    [Fact]
    public async Task A_code_is_unique_across_the_whole_catalogue_not_just_within_a_category()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        await catalogue.SubCategories.CreateAsync(Dto(loans, "Personal", "PL"));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.CreateAsync(Dto(cards, "Personal Card", "pl")));

        Assert.Contains("\"PL\" is already used", error.Message);
    }

    [Fact]
    public async Task A_name_only_has_to_be_unique_inside_its_own_category()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        await catalogue.SubCategories.CreateAsync(Dto(loans, "Premium", "LN-PR"));

        // The same name in another category is fine ...
        await catalogue.SubCategories.CreateAsync(Dto(cards, "Premium", "CC-PR"));
        // ... and twice in one is not.
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.CreateAsync(Dto(loans, "premium", "LN-PX")));
        Assert.Contains("already has a sub-category named", error.Message);
    }

    // ---------------------------------------------------------------- ordering and moving

    [Fact]
    public async Task Display_order_is_kept_per_category()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);

        await catalogue.SubCategories.CreateAsync(Dto(loans, "Home Loan", "LN-HM"));
        await catalogue.SubCategories.CreateAsync(Dto(loans, "Car Loan", "LN-CR"));
        var firstCard = await catalogue.SubCategories.CreateAsync(Dto(cards, "Cashback", "CC-CB"));

        Assert.Equal(1, firstCard.DisplayOrder);
        Assert.Equal(new[] { 1, 2 }, await db.SubCategories.Where(s => s.CategoryId == loans.Id).OrderBy(s => s.DisplayOrder).Select(s => s.DisplayOrder).ToArrayAsync());
    }

    [Fact]
    public async Task Moving_a_sub_category_to_another_category_takes_its_products_with_it_and_closes_the_old_gap()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        var home = await catalogue.AddSubCategoryAsync(loans, "Home Loan", "LN-HM", order: 1);
        var car = await catalogue.AddSubCategoryAsync(loans, "Car Loan", "LN-CR", order: 2);
        var product = await catalogue.AddProductAsync(home, code: "HL_1");

        await catalogue.SubCategories.UpdateAsync(home.Id, Dto(cards, "Home Loan", "LN-HM", "Active"));

        // A product reaches its category through its sub-category, so it moved with it — no product was edited.
        var moved = (await catalogue.Products().GetByIdAsync(product.Id, trackView: false))!;
        Assert.Equal(cards.Id, moved.CategoryId);
        Assert.Equal("Cards", moved.CategoryName);
        Assert.Equal(1, (await db.SubCategories.AsNoTracking().SingleAsync(s => s.Id == car.Id)).DisplayOrder);
        Assert.Equal(1, (await db.SubCategories.AsNoTracking().SingleAsync(s => s.Id == home.Id)).DisplayOrder);
    }

    [Fact]
    public async Task Moving_a_sub_category_up_swaps_it_with_its_neighbour()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        await catalogue.SubCategories.CreateAsync(Dto(loans, "Home Loan", "LN-HM"));
        var car = await catalogue.SubCategories.CreateAsync(Dto(loans, "Car Loan", "LN-CR"));

        await catalogue.SubCategories.ReorderAsync(car.Id, "up");

        Assert.Equal(["Car Loan", "Home Loan"], (await catalogue.SubCategories.SearchAsync(new SubCategoryQueryDto { CategoryId = loans.Id })).Items.Select(s => s.Name));
    }

    // ---------------------------------------------------------------- delete

    [Fact]
    public async Task A_sub_category_that_still_has_products_cannot_be_deleted()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.DeleteAsync(sub.Id));

        Assert.Contains("still has products", error.Message);
    }

    [Fact]
    public async Task An_empty_sub_category_can_be_deleted()
    {
        var (_, sub) = await ArrangeAsync();

        Assert.True(await catalogue.SubCategories.DeleteAsync(sub.Id));
        Assert.Null(await catalogue.SubCategories.GetByIdAsync(sub.Id));
    }

    // ---------------------------------------------------------------- listing

    [Fact]
    public async Task The_list_filters_by_category_status_and_search_and_counts_products()
    {
        await catalogue.SeedStatusesAsync();
        var loans = await catalogue.AddCategoryAsync();
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        var home = await catalogue.AddSubCategoryAsync(loans, "Home Loan", "LN-HM");
        await catalogue.AddSubCategoryAsync(loans, "Old Scheme", "LN-OS", status: "Inactive", order: 2);
        await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddProductAsync(home, code: "HL_1");
        await catalogue.AddProductAsync(home, code: "HL_2");

        var inLoans = await catalogue.SubCategories.SearchAsync(new SubCategoryQueryDto { CategoryId = loans.Id });
        Assert.Equal(["Home Loan", "Old Scheme"], inLoans.Items.Select(s => s.Name));
        Assert.Equal(2, inLoans.Items[0].ProductCount);

        Assert.Equal(["Old Scheme"], (await catalogue.SubCategories.SearchAsync(new SubCategoryQueryDto { Status = "Inactive" })).Items.Select(s => s.Name));
        // The category's name is searchable too, so "cards" finds what is filed under Cards.
        Assert.Equal(["Cashback"], (await catalogue.SubCategories.SearchAsync(new SubCategoryQueryDto { Search = "cards" })).Items.Select(s => s.Name));
    }

    [Fact]
    public async Task The_default_order_groups_by_category_in_the_categories_own_order()
    {
        await catalogue.SeedStatusesAsync();
        var cards = await catalogue.AddCategoryAsync("Cards", "CC", order: 2);
        var loans = await catalogue.AddCategoryAsync("Loans", "LN", order: 1);
        await catalogue.AddSubCategoryAsync(cards, "Cashback", "CC-CB");
        await catalogue.AddSubCategoryAsync(loans, "Home Loan", "LN-HM");

        var page = await catalogue.SubCategories.SearchAsync(new SubCategoryQueryDto());

        Assert.Equal(["Home Loan", "Cashback"], page.Items.Select(s => s.Name));
    }

    // ---------------------------------------------------------------- fields

    [Fact]
    public async Task A_fields_key_is_made_from_its_label_and_fields_come_back_in_their_order()
    {
        var (_, sub) = await ArrangeAsync();

        await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Interest Rate (p.a.)", "Percentage"));
        var detail = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Loan Amount", "Currency"));

        Assert.Equal(["interest_rate_p_a", "loan_amount"], detail!.FieldDefinitions.Select(f => f.Key));
        Assert.Equal([1, 2], detail.FieldDefinitions.Select(f => f.SortOrder));
    }

    [Fact]
    public async Task Two_fields_cannot_share_a_key_within_one_sub_category()
    {
        var (_, sub) = await ArrangeAsync();
        await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Interest Rate"));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("interest-rate")));

        Assert.Contains("already exists", error.Message);
    }

    [Fact]
    public async Task A_field_type_that_does_not_exist_is_refused_with_the_ones_that_do()
    {
        var (_, sub) = await ArrangeAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Rate", "Decimalish")));

        Assert.Contains("Choose one of", error.Message);
        Assert.Contains("Currency", error.Message);
    }

    [Theory]
    [InlineData("Dropdown")]
    [InlineData("MultiSelect")]
    public async Task A_choice_field_needs_options_to_choose_from(string type)
    {
        var (_, sub) = await ArrangeAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Tenure", type)));

        Assert.Contains("needs at least one option", error.Message);
    }

    [Fact]
    public async Task Options_are_trimmed_and_deduplicated()
    {
        var (_, sub) = await ArrangeAsync();

        var detail = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Tenure", "Dropdown", f => f.Options = [" 1 year", "1 year", "", "2 years"]));

        Assert.Equal(["1 year", "2 years"], detail!.FieldDefinitions.Single().Options);
    }

    [Fact]
    public async Task A_multi_select_option_cannot_contain_a_comma_because_choices_are_stored_comma_separated()
    {
        var (_, sub) = await ArrangeAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Perks", "MultiSelect", f => f.Options = ["Lounge, priority", "Insurance"])));

        Assert.Contains("comma", error.Message);
    }

    [Fact]
    public async Task Only_one_field_per_sub_category_can_be_the_primary_metric()
    {
        var (_, sub) = await ArrangeAsync();
        await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Interest Rate", "Percentage", f => f.IsPrimaryMetric = true));

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Processing Fee", "Currency", f => f.IsPrimaryMetric = true)));

        Assert.Contains("Only one field", error.Message);
    }

    [Fact]
    public async Task The_primary_metric_field_can_be_saved_again_as_the_primary_metric()
    {
        var (_, sub) = await ArrangeAsync();
        var created = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Interest Rate", "Percentage", f => f.IsPrimaryMetric = true));
        var fieldId = created!.FieldDefinitions.Single().Id;

        var updated = await catalogue.SubCategories.UpdateFieldAsync(sub.Id, fieldId, Field("Interest Rate", "Percentage", f => { f.IsPrimaryMetric = true; f.SortOrder = 1; f.Unit = "% p.a."; }));

        Assert.Equal("% p.a.", updated!.FieldDefinitions.Single().Unit);
    }

    [Fact]
    public async Task A_fields_type_cannot_change_once_products_hold_values_for_it()
    {
        var (_, sub) = await ArrangeAsync();
        var created = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Rate", "Number"));
        var field = created!.FieldDefinitions.Single();
        var product = await catalogue.AddProductAsync(sub);
        db.ProductFieldValues.Add(new ProductFieldValue { ProductId = product.Id, FieldDefinitionId = field.Id, Value = "8.5", NumericValue = 8.5m });
        await db.SaveChangesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.UpdateFieldAsync(sub.Id, field.Id, Field("Rate", "Text")));

        Assert.Contains("Add a new field instead", error.Message);
        // Renaming it is still fine — only the type is locked.
        Assert.NotNull(await catalogue.SubCategories.UpdateFieldAsync(sub.Id, field.Id, Field("Interest Rate", "Number", f => f.SortOrder = 1)));
    }

    [Fact]
    public async Task A_field_that_products_hold_values_for_cannot_be_deleted_and_an_unused_one_can()
    {
        var (_, sub) = await ArrangeAsync();
        await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Rate", "Number"));
        var detail = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Notes"));
        var used = detail!.FieldDefinitions.Single(f => f.Key == "rate");
        var unused = detail.FieldDefinitions.Single(f => f.Key == "notes");
        var product = await catalogue.AddProductAsync(sub);
        db.ProductFieldValues.Add(new ProductFieldValue { ProductId = product.Id, FieldDefinitionId = used.Id, Value = "8" });
        await db.SaveChangesAsync();

        await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.SubCategories.DeleteFieldAsync(sub.Id, used.Id));
        var after = await catalogue.SubCategories.DeleteFieldAsync(sub.Id, unused.Id);

        Assert.Equal(["rate"], after!.FieldDefinitions.Select(f => f.Key));
    }

    [Fact]
    public async Task A_field_of_another_sub_category_is_not_found_here()
    {
        var (category, sub) = await ArrangeAsync();
        var other = await catalogue.AddSubCategoryAsync(category, "Car Loan", "LN-CR", order: 2);
        var created = await catalogue.SubCategories.CreateFieldAsync(other.Id, Field("Rate", "Number"));

        Assert.Null(await catalogue.SubCategories.UpdateFieldAsync(sub.Id, created!.FieldDefinitions.Single().Id, Field("Rate", "Number")));
        Assert.Null(await catalogue.SubCategories.DeleteFieldAsync(sub.Id, created.FieldDefinitions.Single().Id));
    }

    // ---------------------------------------------------------------- format rules on a field

    [Fact]
    public async Task A_fields_format_rules_are_saved_and_read_back()
    {
        var (_, sub) = await ArrangeAsync();

        var detail = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Scheme Code", "Text", f =>
            f.Validations = [new FieldRuleDto { Type = FieldPresets.Custom, Pattern = "^[A-Z]{3}[0-9]{2}$", Message = "Use three letters and two digits, like ABC12." }]));

        var rule = Assert.Single(detail!.FieldDefinitions.Single().Validations);
        Assert.Equal("custom", rule.Type);
        Assert.Equal("^[A-Z]{3}[0-9]{2}$", rule.Pattern);
    }

    [Fact]
    public async Task A_rule_with_no_message_is_refused_when_it_is_saved_not_when_a_product_first_meets_it()
    {
        var (_, sub) = await ArrangeAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Code", "Text", f => f.Validations = [new FieldRuleDto { Type = FieldPresets.PanFormat, Message = " " }])));

        Assert.Contains("needs a message", error.Message);
    }

    [Fact]
    public async Task A_custom_rule_whose_pattern_is_not_a_regular_expression_is_refused()
    {
        var (_, sub) = await ArrangeAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Code", "Text", f => f.Validations = [new FieldRuleDto { Type = FieldPresets.Custom, Pattern = "([unclosed", Message = "Bad." }])));

        Assert.Contains("not a valid regular expression", error.Message);
    }

    /// <summary>The engine fails open on an unknown format, so a renamed one never blocks every product — saving must allow it.</summary>
    [Fact]
    public async Task A_rule_naming_a_format_this_service_does_not_know_is_allowed()
    {
        var (_, sub) = await ArrangeAsync();

        var detail = await catalogue.SubCategories.CreateFieldAsync(sub.Id, Field("Code", "Text", f =>
            f.Validations = [new FieldRuleDto { Type = "someFormatFromManageFormats", Message = "Wrong format." }]));

        Assert.Single(detail!.FieldDefinitions.Single().Validations);
    }
}
