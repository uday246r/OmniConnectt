using Microsoft.EntityFrameworkCore;
using ProductMarketplace.Application.Common;
using ProductMarketplace.Application.Dtos;
using ProductMarketplace.Infrastructure.Data;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// Setup → Statuses: the catalogue of values a record may hold, and which of them make it live.
/// </summary>
/// <remarks>
/// <para>
/// Statuses are administrator-defined, and what "live" means is defined here too — the catalogue asks
/// which statuses are live rather than comparing to the word "Active". That makes this the one screen
/// where a careless click can empty the whole catalogue: mark the only live status as not live and every
/// product disappears; delete a status that records hold and they are left with a value Setup no longer
/// knows. The service refuses both, and these tests pin that it does.
/// </para>
/// </remarks>
public class StatusConfigServiceTests : IDisposable
{
    private readonly AppDbContext db = TestDb.Create();
    private readonly Catalogue catalogue;

    public StatusConfigServiceTests() => catalogue = new Catalogue(db);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static StatusConfigCreateDto Create(string entityType, string value, bool live = false) =>
        new() { EntityType = entityType, Value = value, Label = value, Color = "info", IsLive = live, SortOrder = 9 };

    private static StatusConfigUpdateDto Update(StatusConfigDto from, Action<StatusConfigUpdateDto>? configure = null)
    {
        var dto = new StatusConfigUpdateDto { Label = from.Label, Color = from.Color, Enabled = from.Enabled, IsLive = from.IsLive, SortOrder = from.SortOrder };
        configure?.Invoke(dto);
        return dto;
    }

    private async Task<StatusConfigDto> StatusAsync(string entityType, string value) =>
        (await catalogue.StatusConfigs.GetAllAsync(entityType)).Single(s => s.Value == value);

    // ---------------------------------------------------------------- create

    [Theory]
    [InlineData("Promotion")]
    [InlineData("Application")]
    [InlineData("Review")]
    [InlineData("Banana")]
    public async Task Only_the_catalogues_own_records_can_have_statuses(string entityType)
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.CreateAsync(Create(entityType, "Anything")));

        Assert.Contains("is not a valid entity type", error.Message);
        Assert.Contains("SubCategory", error.Message);
    }

    [Theory]
    [InlineData("Under review")]
    [InlineData("1st")]
    [InlineData("Draft!")]
    public async Task A_status_value_is_a_single_word_of_letters_and_numbers_starting_with_a_letter(string value)
    {
        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.CreateAsync(Create("Product", value)));

        Assert.Contains("must start with a letter", error.Message);
    }

    [Fact]
    public async Task A_status_needs_a_label_and_a_colour()
    {
        var noLabel = Create("Product", "Pending");
        noLabel.Label = " ";
        var noColour = Create("Product", "Pending");
        noColour.Color = "";

        Assert.Contains("Label is required", (await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.CreateAsync(noLabel))).Message);
        Assert.Contains("Choose a colour", (await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.CreateAsync(noColour))).Message);
    }

    [Fact]
    public async Task A_status_cannot_be_created_twice_whatever_its_case()
    {
        await catalogue.SeedStatusesAsync();

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.CreateAsync(Create("Product", "DRAFT")));

        Assert.Contains("already exists", error.Message);
    }

    [Fact]
    public async Task A_new_live_status_makes_products_holding_it_visible_without_any_code_change()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "Featured", "HL_002", status: "Featured");

        await catalogue.StatusConfigs.CreateAsync(Create("Product", "Featured", live: true));

        var shown = await catalogue.Products().SearchAsync(new ProductQueryDto { VisibleOnly = true });
        Assert.Equal(["HL_001", "HL_002"], shown.Items.Select(p => p.Code).Order());
    }

    // ---------------------------------------------------------------- the only live status

    [Fact]
    public async Task The_only_live_status_cannot_be_made_not_live()
    {
        await catalogue.SeedStatusesAsync();
        var active = await StatusAsync("Category", "Active");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.UpdateAsync(active.Id, Update(active, d => d.IsLive = false)));

        Assert.Contains("only live status for Category", error.Message);
        Assert.True((await StatusAsync("Category", "Active")).IsLive);
    }

    [Fact]
    public async Task The_only_live_status_cannot_be_switched_off_either()
    {
        await catalogue.SeedStatusesAsync();
        var active = await StatusAsync("SubCategory", "Active");

        await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.UpdateAsync(active.Id, Update(active, d => d.Enabled = false)));
    }

    [Fact]
    public async Task A_live_status_can_be_retired_once_another_is_live()
    {
        await catalogue.SeedStatusesAsync();
        await catalogue.StatusConfigs.CreateAsync(Create("Category", "Featured", live: true));
        var active = await StatusAsync("Category", "Active");

        var updated = await catalogue.StatusConfigs.UpdateAsync(active.Id, Update(active, d => d.IsLive = false));

        Assert.False(updated!.IsLive);
    }

    [Fact]
    public async Task A_status_can_be_relabelled_and_recoloured_freely()
    {
        await catalogue.SeedStatusesAsync();
        var active = await StatusAsync("Category", "Active");

        var updated = await catalogue.StatusConfigs.UpdateAsync(active.Id, Update(active, d => { d.Label = "Live"; d.Color = "success"; }));

        Assert.Equal(("Live", "success", "Active"), (updated!.Label, updated.Color, updated.Value));
    }

    [Fact]
    public async Task The_only_live_status_cannot_be_deleted()
    {
        await catalogue.SeedStatusesAsync();
        var active = await StatusAsync("SubCategory", "Active");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.DeleteAsync(active.Id));

        Assert.Contains("only live status", error.Message);
    }

    // ---------------------------------------------------------------- in use

    [Fact]
    public async Task A_status_that_records_hold_cannot_be_deleted_and_says_how_many()
    {
        await catalogue.SeedStatusesAsync();
        var (_, sub, _) = await catalogue.AddLiveChainAsync();
        await catalogue.AddProductAsync(sub, "Old", "HL_002", status: "Inactive");
        await catalogue.AddProductAsync(sub, "Older", "HL_003", status: "Inactive");
        var inactive = await StatusAsync("Product", "Inactive");

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => catalogue.StatusConfigs.DeleteAsync(inactive.Id));

        Assert.Contains("2 product records have it", error.Message);
        Assert.Contains("disable it instead", error.Message);
    }

    [Fact]
    public async Task A_status_nothing_holds_can_be_deleted()
    {
        await catalogue.SeedStatusesAsync();
        var inactive = await StatusAsync("Product", "Inactive");

        Assert.True(await catalogue.StatusConfigs.DeleteAsync(inactive.Id));
        Assert.DoesNotContain(await catalogue.StatusConfigs.GetAllAsync("Product"), s => s.Value == "Inactive");
    }

    [Fact]
    public async Task Every_change_to_a_status_is_audited()
    {
        await catalogue.SeedStatusesAsync();
        var created = await catalogue.StatusConfigs.CreateAsync(Create("Product", "Featured"));
        await catalogue.StatusConfigs.UpdateAsync(created.Id, Update(created, d => d.Label = "Featured now"));
        await catalogue.StatusConfigs.DeleteAsync(created.Id);

        var actions = await db.AuditLogs.Select(a => a.Action).ToListAsync();

        Assert.Contains(AuditActions.CreateStatusConfig, actions);
        Assert.Contains(AuditActions.UpdateStatusConfig, actions);
        Assert.Contains(AuditActions.DeleteStatusConfig, actions);
    }

    [Fact]
    public async Task The_list_can_be_narrowed_to_one_kind_of_record_in_display_order()
    {
        await catalogue.SeedStatusesAsync();

        var products = await catalogue.StatusConfigs.GetAllAsync("Product");

        Assert.Equal(["Draft", "Active", "Inactive"], products.Select(s => s.Value));
        Assert.All(products, s => Assert.Equal("Product", s.EntityType));
    }
}
