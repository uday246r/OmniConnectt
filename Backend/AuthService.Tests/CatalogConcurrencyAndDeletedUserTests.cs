using AuthService.Application.DTOs;
using AuthService.Application.Exceptions;
using AuthService.Application.Services;
using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Security;
using AuthService.Options;
using Microsoft.EntityFrameworkCore;
using Xunit;
using MsOptions = Microsoft.Extensions.Options.Options;

namespace AuthService.Tests;

/// <summary>
/// Two fixes that both concern data changing underneath an operation.
/// </summary>
/// <remarks>
/// <para>
/// <b>Lost updates on the admin catalogs.</b> Manage Fields and Manage Formats each save the whole list.
/// Two administrators editing at once meant the second save silently erased the first person's work.
/// A save now carries the version it was based on and is refused (409) if someone saved in between.
/// </para>
/// <para>
/// <b>Deleted users' security rows.</b> Users are soft-deleted and filtered out of every query; their
/// refresh tokens, invites and permission overrides were not, which EF warned about at startup. Adding
/// the matching filter must not blind token-reuse detection: a stolen, already-revoked token of a
/// deleted user presented again is still recognised as reuse, and never signs anyone in.
/// </para>
/// </remarks>
public class CatalogConcurrencyAndDeletedUserTests : IDisposable
{
    private readonly AuthDbContext db = TestDb.Create("catalog-concurrency");

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public async Task A_field_schema_save_based_on_an_older_version_is_refused()
    {
        var service = new UserFieldSchemaAppService(db, TestAudit.For(db));
        var loaded = await service.GetAsync();
        await service.UpdateAsync(new UpdateUserFieldSchemaRequest(loaded.Fields, loaded.Version), null);

        var stale = new UpdateUserFieldSchemaRequest(loaded.Fields, loaded.Version);

        await Assert.ThrowsAsync<ConflictAppException>(() => service.UpdateAsync(stale, null));
    }

    [Fact]
    public async Task A_formats_save_based_on_an_older_version_is_refused_and_a_current_one_is_accepted()
    {
        var service = new ValidationPresetAppService(db, TestAudit.For(db));
        var loaded = await service.GetAsync();

        var first = await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([], loaded.Version), null);

        await Assert.ThrowsAsync<ConflictAppException>(() =>
            service.UpdateAsync(new UpdateValidationPresetCatalogRequest([], loaded.Version), null));
        var next = await service.UpdateAsync(new UpdateValidationPresetCatalogRequest([], first.Version), null);
        Assert.Equal(first.Version + 1, next.Version);
    }

    [Fact]
    public async Task A_caller_that_sends_no_version_still_saves()
    {
        var service = new UserFieldSchemaAppService(db, TestAudit.For(db));
        var loaded = await service.GetAsync();

        var saved = await service.UpdateAsync(new UpdateUserFieldSchemaRequest(loaded.Fields), null);

        Assert.True(saved.Version > loaded.Version);
    }

    [Fact]
    public async Task Reusing_a_revoked_token_of_a_deleted_user_is_still_detected_as_reuse()
    {
        var user = new User { Id = Guid.NewGuid(), Name = "Gone", Email = "gone@example.com" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var tokens = new RefreshTokenService(db, MsOptions.Create(new JwtOptions()));
        var issued = await tokens.IssueAsync(user.Id, null);
        await tokens.RevokeAsync(issued.RawToken);
        user.IsDeleted = true;
        await db.SaveChangesAsync();

        var result = await tokens.RotateAsync(issued.RawToken, null);

        Assert.Equal(RefreshFailureReason.Reused, result.Failure);
    }

    [Fact]
    public async Task A_live_token_of_a_deleted_user_does_not_sign_them_in()
    {
        var user = new User { Id = Guid.NewGuid(), Name = "Gone", Email = "gone2@example.com" };
        db.Users.Add(user);
        await db.SaveChangesAsync();
        var tokens = new RefreshTokenService(db, MsOptions.Create(new JwtOptions()));
        var issued = await tokens.IssueAsync(user.Id, null);
        user.IsDeleted = true;
        await db.SaveChangesAsync();

        var result = await tokens.RotateAsync(issued.RawToken, null);

        Assert.NotNull(result.Failure);
        Assert.Null(result.User);
    }

    [Fact]
    public async Task A_deleted_users_overrides_and_tokens_are_hidden_from_ordinary_queries()
    {
        var user = new User { Id = Guid.NewGuid(), Name = "Gone", Email = "gone3@example.com", IsDeleted = true };
        db.Users.Add(user);
        db.RefreshTokens.Add(new RefreshToken { Id = Guid.NewGuid(), UserId = user.Id, TokenHash = "h", ExpiresAt = DateTimeOffset.UtcNow.AddDays(1) });
        await db.SaveChangesAsync();

        Assert.Empty(await db.RefreshTokens.ToListAsync());
        Assert.Single(await db.RefreshTokens.IgnoreQueryFilters().ToListAsync());
    }
}
