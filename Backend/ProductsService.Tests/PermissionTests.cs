using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Controllers;
using ProductMarketplace.Api.Infrastructure.Security;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// What a platform token lets a caller do here, and what this service tells AuthService can be granted.
/// </summary>
/// <remarks>
/// The two halves must agree. The capability list used to be typed by hand and enforced nowhere, and one
/// entry (the dashboard) carried a type that kept it out of the token while the sidebar demanded it from
/// there — so no non-administrator could ever see the Dashboard. Discovery is now reflected from the
/// attributes that enforce access, and these tests pin both the decision and the published catalogue.
/// </remarks>
public class PermissionTests
{
    private static IActionResult? Decide(System.Security.Claims.ClaimsPrincipal user, params (string, string)[] alternatives) =>
        PlatformPermissions.Evaluate(user, "products", alternatives);

    [Fact]
    public void A_caller_without_a_token_is_told_to_sign_in()
    {
        Assert.IsType<UnauthorizedResult>(Decide(Tokens.Anonymous(), ("products", "View")));
    }

    [Fact]
    public void The_exact_permission_grants_access()
    {
        Assert.Null(Decide(Tokens.User(permissions: "remote.products.products:View"), ("products", "View")));
    }

    [Fact]
    public void A_permission_in_the_same_app_does_not_grant_a_different_one()
    {
        var result = Assert.IsType<ObjectResult>(Decide(Tokens.User(permissions: "remote.products.products:View"), ("products", "Delete")));

        Assert.Equal(403, result.StatusCode);
    }

    [Fact]
    public void A_permission_for_another_app_with_the_same_module_name_grants_nothing()
    {
        Assert.NotNull(Decide(Tokens.User(permissions: "remote.customer360.products:View"), ("products", "View")));
    }

    [Fact]
    public void Administrators_pass_every_check()
    {
        Assert.Null(Decide(Tokens.User(administrator: true), ("setup", "Manage")));
    }

    [Fact]
    public void Any_of_passes_when_one_alternative_is_held()
    {
        Assert.Null(Decide(Tokens.User(permissions: "remote.products.products:View"), ("setup", "View"), ("products", "View")));
        Assert.NotNull(Decide(Tokens.User(permissions: "remote.products.audit:View"), ("setup", "View"), ("products", "View")));
    }

    [Fact]
    public void The_app_key_comes_from_configuration_not_the_code()
    {
        Assert.Null(PlatformPermissions.Evaluate(Tokens.User(permissions: "remote.marketplace.products:View"), "marketplace", [("products", "View")]));
    }

    [Fact]
    public void A_malformed_permissions_claim_grants_nothing_rather_than_failing()
    {
        var user = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity(
            [new System.Security.Claims.Claim("sub", Guid.NewGuid().ToString()), new System.Security.Claims.Claim("perms", "not json")], "Test"));

        Assert.NotNull(Decide(user, ("products", "View")));
    }

    // ---------------------------------------------------------------- discovery

    [Fact]
    public void Every_capability_an_endpoint_demands_is_published_as_Api()
    {
        var published = PermissionsController.Discover()
            .SelectMany(m => m.Capabilities.Where(c => c.Type == "Api").Select(c => (m.Key, c.Key)))
            .ToHashSet();

        foreach (var enforced in PermissionsController.ReflectEnforced())
        {
            Assert.Contains(enforced, published);
        }
    }

    [Fact]
    public void Nothing_is_published_as_Api_that_no_endpoint_enforces()
    {
        var enforced = PermissionsController.ReflectEnforced().ToHashSet();

        foreach (var module in PermissionsController.Discover())
        foreach (var capability in module.Capabilities.Where(c => c.Type == "Api"))
        {
            Assert.Contains((module.Key, capability.Key), enforced);
        }
    }

    /// <summary>The bug that hid the Dashboard from everyone but administrators.</summary>
    [Fact]
    public void Every_sidebar_row_requires_a_capability_that_travels_in_the_token()
    {
        foreach (var module in PermissionsController.Discover())
        foreach (var nav in module.Nav.Where(n => n.RequiredCapability is not null))
        {
            Assert.Contains(module.Capabilities, c => c.Key == nav.RequiredCapability && c.Type == "Api");
        }
    }

    [Fact]
    public void The_audit_download_is_published_as_an_export_capability()
    {
        var audit = PermissionsController.Discover().Single(m => m.Key == "audit");

        Assert.Contains(audit.Capabilities, c => c.Key == "Export" && c.Type == "Export");
    }

    [Fact]
    public void Capabilities_carry_plain_language_labels()
    {
        var products = PermissionsController.Discover().Single(m => m.Key == "products");

        Assert.Equal("Delete products", products.Capabilities.Single(c => c.Key == "Delete").DisplayName);
        Assert.Equal("Products", products.DisplayName);
    }

    [Fact]
    public void Reviews_are_a_grantable_module_but_add_no_sidebar_row()
    {
        var reviews = PermissionsController.Discover().Single(m => m.Key == "reviews");

        Assert.Contains(reviews.Capabilities, c => c.Key == "Moderate");
        Assert.Empty(reviews.Nav);
    }
}
