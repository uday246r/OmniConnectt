using System.Text.Json;
using AuthService.Application.DTOs;
using AuthService.Application.Events;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Caching;
using AuthService.Infrastructure.Email;
using AuthService.Infrastructure.Security;
using AuthService.Infrastructure.Validation;
using AuthService.Options;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// UpdateAsync's handling of CustomFields: null vs. an explicit dictionary.
/// </summary>
/// <remarks>
/// This distinction was the source of a real bug: ProfilePage's self-service update has no
/// custom-field UI and always sends CustomFields: null, which used to be collapsed into "replace
/// with nothing" and silently wiped every custom field (e.g. Aadhar Number) the first time a user
/// edited their own name. The fix is `request.CustomFields ?? DeserializeExtraAttributes(...)` in
/// UpdateAsync — null now means "leave the existing values alone", and only an explicit dictionary
/// (empty or populated) is treated as the full replacement set. Worth its own regression test
/// because the two cases look interchangeable unless you know which is which.
/// </remarks>
public class UserAppServiceTests : IDisposable
{
    private readonly AuthDbContext db;
    private readonly UserAppService service;

    public UserAppServiceTests()
    {
        var options = new DbContextOptionsBuilder<AuthDbContext>()
            .UseInMemoryDatabase($"user-app-service-{Guid.NewGuid()}")
            .Options;

        db = new AuthDbContext(options);

        var events = new NoOpPublisher();
        var passwordHasher = new PasswordHasher();
        // No HttpContext here by design, same as CheckerAssignmentBulkTests — AuditLogAppService
        // tolerates a null HttpContext and these tests exercise the service outside a request.
        var auditLog = new AuditLogAppService(db, events, new HttpContextAccessor());
        var gating = new ApprovalGatingService(db, auditLog, events);
        var invites = new SetPasswordInviteService(
            db, new NoOpEmailSender(), passwordHasher,
            MsOptions.Create(new SmtpOptions()), MsOptions.Create(new PasswordPolicyOptions()),
            auditLog, NullLogger<SetPasswordInviteService>.Instance);
        var fineCapabilities = new FineCapabilityService(db, new MemoryPlatformCache(new MemoryCache(new MemoryCacheOptions())));
        var fieldSchema = new UserFieldSchemaAppService(db, auditLog);
        var schemaValidator = new UserSchemaValidator();
        var validationPresets = new ValidationPresetAppService(db, auditLog);
        var salutations = new SalutationAppService(db, auditLog);

        service = new UserAppService(
            db, passwordHasher, auditLog, new HttpContextAccessor(), gating, invites,
            fineCapabilities, fieldSchema, schemaValidator, validationPresets, salutations);

        // ValidateAndBuildExtraAttributesAsync drops any custom-field key the schema doesn't
        // currently recognise, on both the "preserve" and "replace" paths — so aadharNumber/
        // panNumber have to be registered custom fields for these tests to observe anything.
        fieldSchema.UpdateAsync(
            new UpdateUserFieldSchemaRequest([
                .. UserFieldSchemaAppService.DefaultFields(),
                new FieldDefinitionDto("aadharNumber", "Aadhar Number", false, "text", false, 4, []),
                new FieldDefinitionDto("panNumber", "PAN Number", false, "text", false, 5, []),
            ]),
            actingUserId: null).GetAwaiter().GetResult();
    }

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task Updating_a_user_with_null_custom_fields_leaves_their_existing_extra_attributes_untouched()
    {
        var user = await SeedUserAsync(new Dictionary<string, string> { ["aadharNumber"] = "1234-5678-9012" });

        var request = MakeRequest(user, customFields: null);
        await service.UpdateAsync(user.Id, request, overrides: null, actingUserId: null);

        var saved = await db.Users.AsNoTracking().SingleAsync(u => u.Id == user.Id);
        var extra = JsonSerializer.Deserialize<Dictionary<string, string>>(saved.ExtraAttributes!);
        Assert.Equal("1234-5678-9012", extra!["aadharNumber"]);
    }

    [Fact]
    public async Task Updating_a_user_with_an_explicit_empty_dictionary_wipes_their_extra_attributes()
    {
        var user = await SeedUserAsync(new Dictionary<string, string> { ["aadharNumber"] = "1234-5678-9012" });

        var request = MakeRequest(user, customFields: new Dictionary<string, string>());
        await service.UpdateAsync(user.Id, request, overrides: null, actingUserId: null);

        var saved = await db.Users.AsNoTracking().SingleAsync(u => u.Id == user.Id);
        Assert.Null(saved.ExtraAttributes);
    }

    [Fact]
    public async Task Updating_a_user_with_a_populated_dictionary_replaces_extra_attributes_with_exactly_that_dictionary()
    {
        var user = await SeedUserAsync(new Dictionary<string, string> { ["aadharNumber"] = "1234-5678-9012" });

        var request = MakeRequest(user, customFields: new Dictionary<string, string> { ["panNumber"] = "ABCDE1234F" });
        await service.UpdateAsync(user.Id, request, overrides: null, actingUserId: null);

        var saved = await db.Users.AsNoTracking().SingleAsync(u => u.Id == user.Id);
        var extra = JsonSerializer.Deserialize<Dictionary<string, string>>(saved.ExtraAttributes!);
        Assert.Equal(new Dictionary<string, string> { ["panNumber"] = "ABCDE1234F" }, extra);
    }

    // ---------------------------------------------------------------- fixture

    private async Task<User> SeedUserAsync(IReadOnlyDictionary<string, string>? extraAttributes)
    {
        var user = new User
        {
            Id = Guid.NewGuid(),
            Name = "Pat Existing",
            Email = "pat@example.com",
            PhoneNumber = "9876543210",
            Status = UserStatus.Active,
            ExtraAttributes = extraAttributes is null ? null : JsonSerializer.Serialize(extraAttributes),
        };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        return user;
    }

    private static UpdateUserRequest MakeRequest(User user, IReadOnlyDictionary<string, string>? customFields) =>
        new(user.Name, user.Email, user.PhoneNumber!, RoleId: null, IsActive: true, CustomFields: customFields);

    private sealed class NoOpPublisher : IPlatformEventPublisher
    {
        public Task PublishToApprovalViewersAsync(PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToAuditViewersAsync(PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToCheckerAssignmentViewersAsync(PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishToUsersAsync(IEnumerable<Guid> userIds, PlatformEvent @event, CancellationToken ct = default) => Task.CompletedTask;
        public Task PublishBadgeAsync(Guid userId, int pendingCount, CancellationToken ct = default) => Task.CompletedTask;
        public void RequestKpiRefresh() { }
    }

    private sealed class NoOpEmailSender : IEmailSender
    {
        public bool IsEnabled => false;

        public Task<bool> SendAsync(string toAddress, string toName, string subject, string htmlBody, string textBody, CancellationToken ct = default) =>
            Task.FromResult(false);
    }
}
