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
    [InlineData(typeof(InternalApprovalsController), typeof(InternalApiKeyFilter))]
    [InlineData(typeof(InternalCatalogController), typeof(InternalCatalogKeyFilter))]
    public void The_internal_endpoints_are_guarded_by_an_internal_key(Type controller, Type expectedFilter)
    {
        var filter = controller.GetCustomAttribute<TypeFilterAttribute>();

        Assert.NotNull(filter);
        Assert.Equal(expectedFilter, filter!.ImplementationType);
    }

    /// <summary>
    /// Lead Management holds the catalogue key. If that were the same secret as the one AuthService uses
    /// to replay approved changes, a service that only reads product names could apply them.
    /// </summary>
    [Fact]
    public async Task The_catalogue_key_cannot_open_the_approval_replay_endpoint_and_the_reverse()
    {
        var options = Microsoft.Extensions.Options.Options.Create(new ProductMarketplace.Api.Options.InternalApiOptions { ApiKey = "replay-key", CatalogApiKey = "catalogue-key" });

        async Task<int?> Status(Microsoft.AspNetCore.Mvc.Filters.IAsyncAuthorizationFilter filter, string key)
        {
            var http = new DefaultHttpContext();
            http.Request.Headers["X-Internal-Api-Key"] = key;
            var context = new Microsoft.AspNetCore.Mvc.Filters.AuthorizationFilterContext(
                new Microsoft.AspNetCore.Mvc.ActionContext(http, new Microsoft.AspNetCore.Routing.RouteData(), new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor()), []);
            await filter.OnAuthorizationAsync(context);
            return (context.Result as ObjectResult)?.StatusCode;
        }

        Assert.Null(await Status(new InternalCatalogKeyFilter(options), "catalogue-key"));
        Assert.Equal(401, await Status(new InternalCatalogKeyFilter(options), "replay-key"));
        Assert.Null(await Status(new InternalApiKeyFilter(options), "replay-key"));
        Assert.Equal(401, await Status(new InternalApiKeyFilter(options), "catalogue-key"));
    }

    [Fact]
    public async Task The_catalogue_refuses_everyone_until_its_key_is_configured()
    {
        var options = Microsoft.Extensions.Options.Options.Create(new ProductMarketplace.Api.Options.InternalApiOptions { ApiKey = "replay-key" });
        var http = new DefaultHttpContext();
        http.Request.Headers["X-Internal-Api-Key"] = "";
        var context = new Microsoft.AspNetCore.Mvc.Filters.AuthorizationFilterContext(
            new Microsoft.AspNetCore.Mvc.ActionContext(http, new Microsoft.AspNetCore.Routing.RouteData(), new Microsoft.AspNetCore.Mvc.Abstractions.ActionDescriptor()), []);

        await new InternalCatalogKeyFilter(options).OnAuthorizationAsync(context);

        Assert.Equal(503, ((ObjectResult)context.Result!).StatusCode);
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
