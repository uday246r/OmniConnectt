using System.Net;
using LeadManagement.Api.Data;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using LeadManagement.Api.Options;
using LeadManagement.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace LeadService.Tests;

/// <summary>
/// A lead is taken for a product the Marketplace offers, and for nothing else.
/// </summary>
/// <remarks>
/// <para>
/// Lead Management used to keep its own product list — seven names typed into a migration — and match the
/// browser's product <i>name</i> against it. The product now comes from the Marketplace, which means three
/// things have to hold that the old design never had to think about: a product that has been withdrawn
/// must be refused even by a form that was opened before it was; a lead must keep saying what its product
/// was called when it was taken, whatever happens to the product afterwards; and an outage of the
/// Marketplace must not let a lead through for a product nobody could confirm.
/// </para>
/// <para>
/// The lead form for a product is the lead form for its <i>sub-category</i> — so every "Home Loan" product
/// shares one configuration, and a sub-category created in the Marketplace today can take leads today.
/// </para>
/// </remarks>
public class LeadCatalogTests : IDisposable
{
    private readonly ApplicationDbContext db = new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseInMemoryDatabase($"lead-catalog-{Guid.NewGuid()}").Options);
    private readonly FakeMarketplace marketplace = new();
    private readonly ProductCatalogClient catalog;
    private readonly LeadFieldConfigService fieldConfig;
    private readonly LeadManagement.Api.Services.LeadService leads;

    public LeadCatalogTests()
    {
        // The in-memory provider does not apply the migration's seed data, so the one state used is added here.
        db.States.Add(new State { Code = "KUL", Name = "KUALA LUMPUR" });
        db.SaveChanges();
        catalog = marketplace.Client();
        var auth = new AuthServiceClient(
            new HttpClient(new StubHandler(() => new HttpResponseMessage(HttpStatusCode.OK))),
            MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
            NullLogger<AuthServiceClient>.Instance,
            new HttpContextAccessor());
        var self = MsOptions.Create(new SelfOptions());
        fieldConfig = new LeadFieldConfigService(db, auth, self, catalog);
        var presets = new ValidationPresetClient(
            new HttpClient(new StubHandler(() => new HttpResponseMessage(HttpStatusCode.OK))),
            MsOptions.Create(new AuthIntegrationOptions()),
            new MemoryCache(new MemoryCacheOptions()), new ValidationPresetClient.LastKnownGood(), NullLogger<ValidationPresetClient>.Instance);
        leads = new LeadManagement.Api.Services.LeadService(db, new AuditLogService(db, new HttpContextAccessor(), new AuditActorContext()), auth, self, fieldConfig, presets, catalog);
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static CreateLeadDto Application(Guid? productId, string ic = "880512-14-5678") => new()
    {
        CatalogProductId = productId ?? Guid.Empty,
        CustomerName = "Asha Rao",
        IcNumber = ic,
        PhoneCountryCode = "+60",
        PhoneNumber = "12-345 6789",
        Email = "asha@example.com",
        State = "KUALA LUMPUR",
        EmployerName = "Acme Sdn Bhd",
        AppliedAmount = "50000",
        MarketingConsent = "Yes",
        AgreedToPrivacyPolicy = true,
    };

    private Task<MutationResult<LeadRecordDto>> CreateAsync(CreateLeadDto dto) => leads.CreateLeadAsync(dto, actingUserId: null, bypassApproval: true);

    // ── Creating a lead ─────────────────────────────────────────────────────────

    [Fact]
    public async Task A_lead_records_the_marketplace_product_and_a_snapshot_of_where_it_sat()
    {
        var created = (await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id))).Applied!;

        var saved = await db.Leads.AsNoTracking().SingleAsync(l => l.Id == Guid.Parse(created.Id));
        Assert.Equal(FakeMarketplace.HomeLoanSalaried.Id, saved.CatalogProductId);
        Assert.Equal("Home Loan – Salaried", saved.ProductName);
        Assert.Equal("HL_001", saved.ProductCode);
        Assert.Equal(FakeMarketplace.HomeLoanId, saved.CatalogSubCategoryId);
        Assert.Equal("Home Loan", saved.SubCategoryName);
        Assert.Equal("LN-HM", saved.SubCategoryCode);
        Assert.Equal(FakeMarketplace.LoansId, saved.CatalogCategoryId);
        Assert.Equal("Loans", saved.CategoryName);
        Assert.Equal("Home Loan – Salaried", created.Product);
        Assert.Equal(FakeMarketplace.HomeLoanSalaried.Id, created.CatalogProductId);
    }

    [Fact]
    public async Task What_the_browser_says_the_product_is_called_is_never_trusted()
    {
        // There is no name on the request at all; only an id, which the Marketplace resolves.
        var created = (await CreateAsync(Application(FakeMarketplace.CashbackCard.Id))).Applied!;

        Assert.Equal("Cashback Card", created.Product);
        Assert.Equal("Credit Cards", created.CategoryName);
    }

    [Fact]
    public async Task A_product_the_marketplace_no_longer_offers_is_refused_and_no_lead_is_saved()
    {
        marketplace.Offered.Remove(FakeMarketplace.HomeLoanSalaried);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id)));

        Assert.Contains("no longer offered", ex.Message);
        Assert.Empty(db.Leads);
    }

    [Fact]
    public async Task Leaving_the_product_out_is_refused()
    {
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateAsync(Application(null)));

        Assert.Contains("Product selection is required", ex.Message);
    }

    [Fact]
    public async Task If_the_marketplace_cannot_be_reached_the_lead_is_not_filed_rather_than_filed_against_an_unconfirmed_product()
    {
        marketplace.Down = true;

        var ex = await Assert.ThrowsAsync<CatalogUnavailableException>(() => CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id)));

        // It is answered as a 503 exactly like an approval check that could not be made.
        Assert.IsAssignableFrom<ApprovalServiceUnavailableException>(ex);
        Assert.Empty(db.Leads);
    }

    [Fact]
    public async Task The_product_is_confirmed_afresh_for_every_lead_and_never_from_a_cached_answer()
    {
        await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id, ic: "880512-14-0001"));
        await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id, ic: "880512-14-0002"));

        Assert.Equal(2, marketplace.Calls);
    }

    [Fact]
    public async Task The_same_person_can_have_a_lead_for_each_of_two_products_but_the_dedupe_key_follows_the_id_not_the_name()
    {
        await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id));
        await CreateAsync(Application(FakeMarketplace.CashbackCard.Id));

        Assert.Equal(2, await db.Leads.CountAsync());
    }

    /// <summary>
    /// A gated lead is stored as JSON at submission and rebuilt when a checker approves it — with the
    /// same call the internal approvals endpoint makes. The product must survive that trip as an id, and
    /// be confirmed with the Marketplace again at approval time (it may have been withdrawn while the
    /// request waited).
    /// </summary>
    [Fact]
    public async Task An_approved_lead_is_rebuilt_from_its_stored_request_and_the_product_is_confirmed_again()
    {
        var stored = System.Text.Json.JsonSerializer.Serialize(Application(FakeMarketplace.HomeLoanSalaried.Id));

        var replayed = System.Text.Json.JsonSerializer.Deserialize<CreateLeadDto>(stored)!;
        var created = (await CreateAsync(replayed)).Applied!;

        Assert.Equal(FakeMarketplace.HomeLoanSalaried.Id, created.CatalogProductId);
        Assert.Equal("Home Loan – Salaried", created.Product);

        marketplace.Offered.Remove(FakeMarketplace.HomeLoanSalaried);
        var replayedAfterWithdrawal = System.Text.Json.JsonSerializer.Deserialize<CreateLeadDto>(stored)!;
        await Assert.ThrowsAsync<InvalidOperationException>(() => CreateAsync(replayedAfterWithdrawal));
    }

    // ── History does not move ───────────────────────────────────────────────────

    [Fact]
    public async Task A_lead_keeps_the_name_its_product_had_when_the_product_is_later_renamed_or_withdrawn()
    {
        var created = (await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id))).Applied!;

        marketplace.Offered.Clear();

        var listed = (await leads.GetLeadsAsync(1, 10, null, null, null, null, null, null, null)).Items.Single();
        Assert.Equal(created.Id, listed.Id);
        Assert.Equal("Home Loan – Salaried", listed.Product);
        Assert.Equal("Loans", listed.CategoryName);
    }

    [Fact]
    public async Task Leads_are_found_by_the_product_name_they_were_taken_under()
    {
        await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id));
        await CreateAsync(Application(FakeMarketplace.CashbackCard.Id));

        var byProduct = await leads.GetLeadsAsync(1, 10, null, "Cashback Card", null, null, null, null, null);
        var byCategory = await leads.GetLeadsAsync(1, 10, "loans", null, null, null, null, null, null);

        Assert.Equal(["Cashback Card"], byProduct.Items.Select(l => l.Product));
        Assert.Equal(["Home Loan – Salaried"], byCategory.Items.Select(l => l.Product));
    }

    [Fact]
    public async Task The_product_filter_offers_the_products_leads_exist_for_including_ones_since_withdrawn()
    {
        await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id, ic: "880512-14-0001"));
        await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id, ic: "880512-14-0002"));
        await CreateAsync(Application(FakeMarketplace.CashbackCard.Id));
        marketplace.Offered.Clear();

        Assert.Equal(["Cashback Card", "Home Loan – Salaried"], await leads.GetProductNamesAsync());
    }

    // ── Editing ─────────────────────────────────────────────────────────────────

    private UpdateLeadDto Edit(Guid? productId, string employer = "Acme Sdn Bhd")
    {
        var dto = Application(productId);
        return new UpdateLeadDto
        {
            CatalogProductId = dto.CatalogProductId, CustomerName = dto.CustomerName, IcNumber = dto.IcNumber,
            PhoneCountryCode = dto.PhoneCountryCode, PhoneNumber = dto.PhoneNumber, Email = dto.Email, State = dto.State,
            EmployerName = employer, AppliedAmount = dto.AppliedAmount, MarketingConsent = dto.MarketingConsent,
            AgreedToPrivacyPolicy = true, EditReason = "Correcting the employer",
        };
    }

    [Fact]
    public async Task A_lead_for_a_withdrawn_product_can_still_be_edited_without_choosing_a_product_again()
    {
        var created = (await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id))).Applied!;
        marketplace.Offered.Clear();
        marketplace.Down = true; // and nothing may be asked of the Marketplace to save an unchanged product

        var updated = (await leads.UpdateLeadAsync(created.Id, Edit(null, employer: "New Employer"), null, bypassApproval: true)).Applied!;

        Assert.Equal("New Employer", updated.EmployerName);
        Assert.Equal("Home Loan – Salaried", updated.Product);
    }

    [Fact]
    public async Task Sending_the_leads_own_product_back_changes_nothing_and_asks_nothing_of_the_marketplace()
    {
        var created = (await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id))).Applied!;
        var before = marketplace.Calls;

        await leads.UpdateLeadAsync(created.Id, Edit(FakeMarketplace.HomeLoanSalaried.Id), null, bypassApproval: true);

        Assert.Equal(before, marketplace.Calls);
    }

    [Fact]
    public async Task Moving_a_lead_to_a_different_product_needs_a_product_the_marketplace_currently_offers()
    {
        var created = (await CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id))).Applied!;

        var moved = (await leads.UpdateLeadAsync(created.Id, Edit(FakeMarketplace.CashbackCard.Id), null, bypassApproval: true)).Applied!;
        Assert.Equal("Cashback Card", moved.Product);
        Assert.Equal("Credit Cards", moved.CategoryName);

        marketplace.Offered.Remove(FakeMarketplace.HomeLoanSalaried);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            leads.UpdateLeadAsync(created.Id, Edit(FakeMarketplace.HomeLoanSalaried.Id), null, bypassApproval: true));
    }

    [Fact]
    public async Task A_lead_taken_before_the_catalogue_was_connected_stays_editable_and_keeps_its_product_name()
    {
        var state = await db.States.FirstAsync(s => s.Name == "KUALA LUMPUR");
        var legacy = new Lead
        {
            LeadReference = "LEAD-OLD", CustomerName = "Old Customer", IcNumber = "880512-14-5678", PhoneNumber = "12-345 6789",
            Email = "old@example.com", StateId = state.Id, EmployerName = "Old Co", AppliedAmount = 1000m, ProductName = "ASB Financing", ProductCode = "ASB",
        };
        db.Leads.Add(legacy);
        await db.SaveChangesAsync();

        var updated = (await leads.UpdateLeadAsync(legacy.Id.ToString(), Edit(null, employer: "Renamed Co"), null, bypassApproval: true)).Applied!;

        Assert.Equal("ASB Financing", updated.Product);
        Assert.Null(updated.CatalogProductId);
        Assert.Equal("Renamed Co", updated.EmployerName);
    }

    // ── Field settings follow the sub-category ──────────────────────────────────

    [Fact]
    public async Task A_sub_category_seen_for_the_first_time_gets_a_default_lead_form()
    {
        Assert.Empty(db.LeadFieldConfigs);

        var config = await fieldConfig.GetBySubCategoryAsync(FakeMarketplace.HomeLoanId);

        Assert.Contains(config, f => f.ApiField == "customerName" && f.Required && f.Visible);
        Assert.Contains(config, f => f.ApiField == "icNumber" && f.Sensitive);
    }

    [Fact]
    public async Task Product_details_start_hidden_and_optional_so_no_product_name_decides_who_sees_them()
    {
        var config = await fieldConfig.GetBySubCategoryAsync(FakeMarketplace.HomeLoanId);

        foreach (var (apiField, _) in LeadFieldConfigService.OptionalDetailFields)
        {
            var row = Assert.Single(config, f => f.ApiField == apiField);
            Assert.False(row.Visible);
            Assert.False(row.Required);
        }
    }

    [Fact]
    public async Task Asking_twice_does_not_duplicate_the_defaults_or_undo_an_administrators_edit()
    {
        var first = await fieldConfig.GetBySubCategoryAsync(FakeMarketplace.HomeLoanId);
        await fieldConfig.ReplaceAsync(FakeMarketplace.HomeLoanId,
            [new LeadFieldConfig { ApiField = "propertyType", DisplayLabel = "Type of property", Section = "Product Details", Visible = true, Required = true, Editable = true }],
            actingUserId: null, bypassApproval: true);

        var second = await fieldConfig.GetBySubCategoryAsync(FakeMarketplace.HomeLoanId);

        Assert.Equal(first.Count, second.Count);
        var edited = Assert.Single(second, f => f.ApiField == "propertyType");
        Assert.True(edited.Visible);
        Assert.Equal("Type of property", edited.DisplayLabel);
    }

    [Fact]
    public async Task Field_settings_can_only_be_saved_for_a_sub_category_the_marketplace_offers()
    {
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            fieldConfig.ReplaceAsync(Guid.NewGuid(), [new LeadFieldConfig { ApiField = "email", DisplayLabel = "Email", Section = "S" }], actingUserId: null, bypassApproval: true));

        Assert.Contains("not in the product catalogue", ex.Message);
    }

    [Fact]
    public async Task A_required_product_detail_an_administrator_switched_on_is_enforced_when_the_lead_is_filed()
    {
        await fieldConfig.GetBySubCategoryAsync(FakeMarketplace.HomeLoanId);
        await fieldConfig.ReplaceAsync(FakeMarketplace.HomeLoanId,
            [new LeadFieldConfig { ApiField = "propertyType", DisplayLabel = "Property Type", Section = "Product Details", Visible = true, Required = true, Editable = true }],
            actingUserId: null, bypassApproval: true);

        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => CreateAsync(Application(FakeMarketplace.HomeLoanSalaried.Id)));
        Assert.Contains("Property Type", ex.Message);

        // The same lead for a product in another sub-category is unaffected.
        var other = (await CreateAsync(Application(FakeMarketplace.CashbackCard.Id))).Applied!;
        Assert.Equal("Cashback Card", other.Product);
    }

    [Fact]
    public async Task Product_details_the_form_collected_are_kept_whatever_the_product_is_called()
    {
        var dto = Application(FakeMarketplace.CashbackCard.Id);
        dto.PropertyType = "Apartment";
        dto.PropertyStatus = "Completed";

        var created = (await CreateAsync(dto)).Applied!;

        Assert.Equal("Apartment", (await leads.GetLeadByIdAsync(created.Id))!.PropertyType);
    }

    // ── The client ──────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_client_sends_the_internal_key_and_lists_categories_and_their_products()
    {
        var categories = await catalog.GetCategoriesAsync();
        var products = await catalog.GetProductsAsync(FakeMarketplace.LoansId);

        Assert.Equal(["Credit Cards", "Loans"], categories.Select(c => c.Name).Order());
        Assert.Equal(["Home Loan – Salaried"], products.Select(p => p.Name));
        Assert.Equal("products-key", marketplace.LastKey);
    }

    [Fact]
    public async Task The_pickers_keep_working_from_the_last_list_read_when_the_marketplace_goes_away()
    {
        // A fresh client per call, like a scoped one — only the process-wide last-known-good survives.
        var first = await marketplace.Client().GetCategoriesAsync();
        marketplace.Down = true;

        var during = await marketplace.Client().GetCategoriesAsync();

        Assert.Equal(first.Select(c => c.Id), during.Select(c => c.Id));
    }

    [Fact]
    public async Task A_picker_with_nothing_ever_read_says_the_catalogue_is_unavailable_instead_of_showing_an_empty_list()
    {
        marketplace.Down = true;

        await Assert.ThrowsAsync<CatalogUnavailableException>(() => marketplace.Client().GetCategoriesAsync());
    }

    [Fact]
    public async Task Repeated_picker_reads_are_answered_from_the_cache()
    {
        await catalog.GetCategoriesAsync();
        await catalog.GetCategoriesAsync();

        Assert.Equal(1, marketplace.Calls);
    }

    private sealed class StubHandler(Func<HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond());
    }
}
