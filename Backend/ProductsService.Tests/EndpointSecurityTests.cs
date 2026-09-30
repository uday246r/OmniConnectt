using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using ProductMarketplace.Api.Controllers;
using ProductMarketplace.Api.Infrastructure.Security;
using Xunit;

namespace ProductsService.Tests;

/// <summary>
/// No business endpoint in Products & Marketplace answers an anonymous or unpermitted caller.
/// </summary>
/// <remarks>
/// This service was integrated with no authentication at all: product changes and the catalogue's
/// configuration were served to anyone. The fix is a set of attributes, which is
/// exactly the kind of thing a new endpoint forgets — so this test walks every action by reflection and
/// fails for any that lacks a token requirement and a capability, rather than relying on someone to add a
/// test per endpoint.
/// </remarks>
public class EndpointSecurityTests
{
    /// <summary>The only routes meant to be reachable without a user token, and what guards them instead.</summary>
    private static readonly Dictionary<Type, string> Exempt = new()
    {
        [typeof(PermissionsController)] = "capability discovery, read by AuthService during registration",
        [typeof(InternalApprovalsController)] = "internal replay, guarded by the internal key",
        [typeof(InternalCatalogController)] = "catalogue lookups for Lead Management, guarded by the internal key",
    };

    public static IEnumerable<object[]> Actions() =>
        typeof(PermissionsController).Assembly.GetTypes()
            .Where(t => typeof(ControllerBase).IsAssignableFrom(t) && !t.IsAbstract && !Exempt.ContainsKey(t))
            .SelectMany(t => t.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(m => m.GetCustomAttributes().Any(a => a is Microsoft.AspNetCore.Mvc.Routing.HttpMethodAttribute))
                .Select(m => new object[] { t.Name, m.Name }));

    [Theory]
    [MemberData(nameof(Actions))]
    public void Every_business_endpoint_requires_a_signed_in_user(string controller, string action)
    {
        var (type, method) = Find(controller, action);

        Assert.True(type.GetCustomAttribute<AuthorizeAttribute>() is not null || method.GetCustomAttribute<AuthorizeAttribute>() is not null,
            $"{controller}.{action} does not require a signed-in user.");
        Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.Null(type.GetCustomAttribute<AllowAnonymousAttribute>());
    }

    [Theory]
    [MemberData(nameof(Actions))]
    public void Every_business_endpoint_requires_a_capability(string controller, string action)
    {
        var (type, method) = Find(controller, action);
        bool Guards(MemberInfo m) =>
            m.GetCustomAttributes<RequiresCapabilityAttribute>().Any() || m.GetCustomAttributes<RequiresAnyCapabilityAttribute>().Any();

        Assert.True(Guards(type) || Guards(method), $"{controller}.{action} is reachable by any signed-in user regardless of role.");
    }

    [Theory]
    [InlineData(typeof(InternalApprovalsController))]
    [InlineData(typeof(InternalCatalogController))]
    public void The_internal_endpoints_are_guarded_by_the_internal_key(Type controller)
    {
        var filter = controller.GetCustomAttribute<TypeFilterAttribute>();

        Assert.NotNull(filter);
        Assert.Equal(typeof(InternalApiKeyFilter), filter!.ImplementationType);
    }

    [Theory]
    [InlineData("ProductsController", "Delete", "products", "Delete")]
    [InlineData("CategoriesController", "Delete", "categories", "Delete")]
    [InlineData("SubCategoriesController", "Delete", "subcategories", "Delete")]
    [InlineData("SubCategoriesController", "CreateField", "setup", "Manage")]
    [InlineData("StatusConfigsController", "Create", "setup", "Manage")]
    [InlineData("AuditLogsController", "Search", "audit", "View")]
    public void Sensitive_endpoints_demand_the_specific_capability(string controller, string action, string module, string capability)
    {
        var (type, method) = Find(controller, action);
        var demanded = type.GetCustomAttributes<RequiresCapabilityAttribute>().Concat(method.GetCustomAttributes<RequiresCapabilityAttribute>());

        Assert.Contains(demanded, a => a.Module == module && a.Capability == capability);
    }

    [Fact]
    public void Downloading_the_audit_log_is_a_separate_permission_from_reading_it()
    {
        var method = typeof(AuditLogsController).GetMethod(nameof(AuditLogsController.Export))!;

        Assert.Contains(method.GetCustomAttributes<RequiresFineCapabilityAttribute>(), a => a.Module == "audit" && a.Capability == "Export");
    }

    private static (Type Type, MethodInfo Method) Find(string controller, string action)
    {
        var type = typeof(PermissionsController).Assembly.GetTypes().Single(t => t.Name == controller);
        return (type, type.GetMethods().First(m => m.Name == action && m.DeclaringType == type));
    }
}
