using System.Net;
using System.Reflection;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using LeadManagement.Api.Controllers;
using LeadManagement.Api.Data;
using LeadManagement.Api.Infrastructure;
using LeadManagement.Api.Infrastructure.Security;
using LeadManagement.Api.Models.Dtos;
using LeadManagement.Api.Models.Entities;
using LeadManagement.Api.Options;
using LeadManagement.Api.Services;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace LeadService.Tests;

/// <summary>
/// Lead fields held to the formats configured for them — the same formats, and the same engine, as user
/// fields in Manage Fields and Manage Formats.
/// </summary>
/// <remarks>
/// <para>
/// The IC number, phone and email checks used to be regexes typed into the request DTO and three more
/// places in the form store. Nobody could change them without a release, an administrator's format
/// from Manage Formats could not be used on a lead at all, and the DTO attributes did not run when an
/// approved request was replayed. They are now Field Settings rules, checked in the service.
/// </para>
/// <para>
/// Also pinned: a lead maker can read the field configuration the forms depend on. It needed Field
/// Settings access, so for everyone else the form silently had no required fields and no masking.
/// </para>
/// </remarks>
public class LeadFormatValidationTests : IDisposable
{
    private readonly ApplicationDbContext db = new(new DbContextOptionsBuilder<ApplicationDbContext>()
        .UseInMemoryDatabase($"lead-formats-{Guid.NewGuid()}").Options);

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    private static List<LeadFieldConfig> Config(params (string ApiField, List<LeadFieldRule> Rules)[] fields) =>
        fields.Select(f => new LeadFieldConfig { ApiField = f.ApiField, DisplayLabel = f.ApiField, Validations = f.Rules }).ToList();

    private static List<LeadFieldConfig> Defaults() => Config(
        ("icNumber", LeadFieldConfigService.DefaultRules("icNumber")),
        ("phoneNumber", LeadFieldConfigService.DefaultRules("phoneNumber")),
        ("email", LeadFieldConfigService.DefaultRules("email")));

    private static CreateLeadDto Lead(string ic = "880512-14-5678", string phone = "12-345 6789", string email = "asha@example.com", string code = "+60") =>
        new() { CatalogProductId = FakeMarketplace.HomeLoanSalaried.Id, IcNumber = ic, PhoneCountryCode = code, PhoneNumber = phone, Email = email };

    private static IReadOnlyDictionary<string, string> ErrorsFor(List<LeadFieldConfig> config, CreateLeadDto dto, IReadOnlyList<FormatPreset>? presets = null, LeadRecordDto? previous = null)
    {
        try
        {
            LeadFieldConfigService.EnsureFormatsValid(config, dto, presets ?? [], previous);
            return new Dictionary<string, string>();
        }
        catch (LeadFieldConfigService.FieldFormatException ex)
        {
            return ex.Errors;
        }
    }

    [Fact]
    public void A_lead_in_the_default_formats_passes()
    {
        Assert.Empty(ErrorsFor(Defaults(), Lead()));
    }

    [Fact]
    public void Each_field_out_of_format_is_named_with_its_own_message()
    {
        var errors = ErrorsFor(Defaults(), Lead(ic: "8805121456", phone: "12", email: "asha@gmail.comsss"));

        Assert.Equal(["email", "icNumber", "phoneNumber"], errors.Keys.Order());
        Assert.Contains("YYMMDD-PB-XXXX", errors["icNumber"]);
    }

    [Fact]
    public void The_phone_number_is_checked_for_the_country_chosen()
    {
        Assert.Empty(ErrorsFor(Defaults(), Lead(code: "+65", phone: "8123 4567")));
        Assert.Contains("phoneNumber", ErrorsFor(Defaults(), Lead(code: "+65", phone: "12-345 6789")).Keys);
    }

    [Fact]
    public void A_number_saved_with_its_country_code_already_in_it_is_not_prefixed_twice()
    {
        Assert.Empty(ErrorsFor(Defaults(), Lead(phone: "+60 12-345 6789")));
    }

    [Fact]
    public void A_format_defined_in_Manage_Formats_is_applied_by_its_key()
    {
        var config = Config(("employerName", [new LeadFieldRule { Type = "companyCode", Message = "Use the company code, e.g. CO-1234." }]));
        var presets = new[] { new FormatPreset("companyCode", "Company code", "regex", "^CO-[0-9]{4}$", null, null, null, null, "Use CO-0000.") };
        var dto = Lead();

        dto.EmployerName = "Acme";
        Assert.Equal("Use the company code, e.g. CO-1234.", ErrorsFor(config, dto, presets)["employerName"]);

        dto.EmployerName = "CO-0042";
        Assert.Empty(ErrorsFor(config, dto, presets));
    }

    [Fact]
    public void A_format_that_was_deleted_from_Manage_Formats_does_not_block_lead_capture()
    {
        var config = Config(("employerName", [new LeadFieldRule { Type = "deletedFormat", Message = "never shown" }]));
        var dto = Lead();
        dto.EmployerName = "anything";

        Assert.Empty(ErrorsFor(config, dto, presets: []));
    }

    [Fact]
    public void An_unchanged_value_on_an_older_lead_is_not_rechecked_when_editing_something_else()
    {
        // The IC format was tightened after this lead was captured. Editing its email must still work.
        var previous = new LeadRecordDto { IcNumber = "88051214567", Phone = "+60 12-345 6789", Email = "old@example.com" };
        var edit = Lead(ic: "88051214567", email: "new@example.com");

        Assert.Empty(ErrorsFor(Defaults(), edit, previous: previous));
        Assert.Contains("icNumber", ErrorsFor(Defaults(), Lead(ic: "88051214568"), previous: previous).Keys);
    }

    [Fact]
    public void Branch_errors_use_the_forms_field_name()
    {
        Assert.Equal("preferredBranch", LeadFieldConfigService.FormFieldName("branch"));
    }

    [Fact]
    public void Field_Settings_refuses_a_rule_that_cannot_work()
    {
        var broken = Config(
            ("icNumber", [new LeadFieldRule { Type = FieldPresets.Custom, Pattern = "([", Message = "x" }]),
            ("customerName", [new LeadFieldRule { Type = FieldPresets.MinLength, Message = "Too short." }]),
            ("email", [new LeadFieldRule { Type = FieldPresets.EmailSmart, Message = "" }]));

        var ex = Assert.Throws<InvalidOperationException>(() => LeadFieldConfigService.EnsureRulesWellFormed(broken));

        Assert.Contains("not a valid pattern", ex.Message);
        Assert.Contains("number of characters", ex.Message);
        Assert.Contains("message", ex.Message);
    }

    [Fact]
    public void A_stored_rule_list_that_cannot_be_read_means_no_rules_rather_than_an_error()
    {
        var row = new LeadFieldConfig { ValidationsJson = "{not json" };

        Assert.Empty(row.Validations);
    }

    [Fact]
    public async Task Saving_Field_Settings_keeps_each_fields_formats_on_update_and_on_insert()
    {
        var subCategoryId = FakeMarketplace.HomeLoanId;
        db.LeadFieldConfigs.Add(new LeadFieldConfig { CatalogSubCategoryId = subCategoryId, ApiField = "icNumber", DisplayLabel = "IC", Section = "S" });
        await db.SaveChangesAsync();
        var service = new LeadFieldConfigService(db, AuthClient(), MsOptions.Create(new SelfOptions()), new FakeMarketplace().Client());
        var rule = new LeadFieldRule { Type = FieldPresets.DigitsOnly, Message = "Digits only." };

        await service.ReplaceAsync(subCategoryId,
        [
            new LeadFieldConfig { ApiField = "icNumber", DisplayLabel = "IC", Section = "S", Validations = [rule] },
            new LeadFieldConfig { ApiField = "employerName", DisplayLabel = "Employer", Section = "S", Validations = [rule] },
        ], actingUserId: null, bypassApproval: true);

        var saved = await db.LeadFieldConfigs.AsNoTracking().Where(f => f.CatalogSubCategoryId == subCategoryId && (f.ApiField == "icNumber" || f.ApiField == "employerName")).ToListAsync();
        Assert.All(saved, f => Assert.Equal(FieldPresets.DigitsOnly, Assert.Single(f.Validations).Type));
    }

    [Fact]
    public async Task Saving_settings_based_on_an_older_version_is_refused_rather_than_undoing_someone_elses_change()
    {
        var subCategoryId = FakeMarketplace.HomeLoanId;
        db.LeadFieldConfigs.Add(new LeadFieldConfig { CatalogSubCategoryId = subCategoryId, ApiField = "companyName", DisplayLabel = "Company", Section = "S" });
        await db.SaveChangesAsync();
        var service = new LeadFieldConfigService(db, AuthClient(), MsOptions.Create(new SelfOptions()), new FakeMarketplace().Client());
        var loadedVersion = LeadFieldConfigService.Fingerprint(await service.GetBySubCategoryAsync(subCategoryId));

        await service.ReplaceAsync(subCategoryId, [new LeadFieldConfig { ApiField = "companyName", DisplayLabel = "Company name", Section = "S" }],
            actingUserId: null, bypassApproval: true, expectedVersion: loadedVersion);

        await Assert.ThrowsAsync<LeadFieldConfigService.StaleSettingsException>(() =>
            service.ReplaceAsync(subCategoryId, [new LeadFieldConfig { ApiField = "companyName", DisplayLabel = "Business name", Section = "S" }],
                actingUserId: null, bypassApproval: true, expectedVersion: loadedVersion));
        Assert.Equal("Company name", (await service.GetBySubCategoryAsync(subCategoryId)).Single(f => f.ApiField == "companyName").DisplayLabel);
    }

    [Fact]
    public void The_rules_travel_to_the_browser_as_a_list_and_never_as_raw_json()
    {
        var row = new LeadFieldConfig { ApiField = "email", Validations = LeadFieldConfigService.DefaultRules("email") };

        var json = JsonSerializer.Serialize(row, new JsonSerializerOptions(JsonSerializerDefaults.Web));

        Assert.Contains("\"validations\":[{\"type\":\"emailSmart\"", json);
        Assert.DoesNotContain("validationsJson", json);
    }

    // ── Reading the configuration ───────────────────────────────────────────────

    [Theory]
    [InlineData("remote.lead.lead:Create")]
    [InlineData("remote.lead.lead:Edit")]
    [InlineData("remote.lead.lead:View")]
    [InlineData("remote.lead.fieldsettings:View")]
    public async Task Anyone_who_works_with_leads_can_read_the_field_configuration(string permission)
    {
        var context = ContextFor(permission);

        await ReadGuard().OnAuthorizationAsync(context);

        Assert.Null(context.Result);
    }

    [Fact]
    public async Task Someone_with_no_lead_access_cannot()
    {
        var context = ContextFor("remote.lead.dashboard:View");

        await ReadGuard().OnAuthorizationAsync(context);

        Assert.Equal(StatusCodes.Status403Forbidden, ((ObjectResult)context.Result!).StatusCode);
    }

    [Fact]
    public void Every_alternative_of_an_any_of_guard_is_still_published_as_a_capability()
    {
        var modules = typeof(PermissionsController)
            .GetMethod("DiscoverModules", BindingFlags.NonPublic | BindingFlags.Static)!
            .Invoke(null, null)!;
        using var json = JsonDocument.Parse(JsonSerializer.Serialize(modules));

        // Field Settings:View is now guarded ONLY through any-of guards. If reflection skipped them, the
        // capability would vanish from discovery — and an empty answer deactivates every role's grant of it.
        var fieldSettings = json.RootElement.EnumerateArray().Single(m => m.GetProperty("Key").GetString() == "fieldsettings");
        var capabilities = fieldSettings.GetProperty("Capabilities").EnumerateArray().Select(c => c.GetProperty("Key").GetString()).ToList();
        Assert.Contains("View", capabilities);
        Assert.Contains("Manage", capabilities);
    }

    // ── The Manage Formats catalog ─────────────────────────────────────────────

    [Fact]
    public async Task When_AuthService_cannot_be_reached_the_last_catalog_read_is_used()
    {
        var lastKnownGood = new ValidationPresetClient.LastKnownGood();
        var calls = 0;
        var handler = new StubHandler(() =>
        {
            calls++;
            return calls == 1
                ? new HttpResponseMessage(HttpStatusCode.OK)
                {
                    Content = new StringContent("""{"presets":[{"key":"companyCode","label":"Company code","kind":"regex","pattern":"^CO-","message":"m"}]}""", Encoding.UTF8, "application/json"),
                }
                : throw new HttpRequestException("down");
        });
        ValidationPresetClient Client() => new(new HttpClient(handler),
            MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
            new MemoryCache(new MemoryCacheOptions()), lastKnownGood, NullLogger<ValidationPresetClient>.Instance);

        var first = await Client().GetAsync();
        var duringOutage = await Client().GetAsync();

        Assert.Equal("companyCode", Assert.Single(first).Key);
        Assert.Equal("companyCode", Assert.Single(duringOutage).Key);
        Assert.Equal(2, calls);
    }

    // ── fixture ─────────────────────────────────────────────────────────────────

    private static RequiresAnyCapabilityAttribute ReadGuard() =>
        typeof(LeadFieldConfigController).GetMethod(nameof(LeadFieldConfigController.Get))!
            .GetCustomAttribute<RequiresAnyCapabilityAttribute>()!;

    private static AuthorizationFilterContext ContextFor(params string[] permissions)
    {
        var user = new ClaimsPrincipal(new ClaimsIdentity(
        [
            new Claim(JwtClaimTypes.Subject, Guid.NewGuid().ToString()),
            new Claim(JwtClaimTypes.Permissions, JsonSerializer.Serialize(permissions)),
        ], "Test"));
        return new(new ActionContext(new DefaultHttpContext { User = user }, new RouteData(), new ActionDescriptor()), []);
    }

    private static AuthServiceClient AuthClient() => new(
        new HttpClient(new StubHandler(() => new HttpResponseMessage(HttpStatusCode.OK))),
        MsOptions.Create(new AuthIntegrationOptions { BaseUrl = "http://auth.test", InternalApiKey = "k" }),
        NullLogger<AuthServiceClient>.Instance,
        new HttpContextAccessor());

    private sealed class StubHandler(Func<HttpResponseMessage> respond) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) =>
            Task.FromResult(respond());
    }
}
