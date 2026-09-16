using System.Security.Claims;
using Microsoft.Extensions.Options;
using ProductMarketplace.Api.Infrastructure.Security;
using ProductMarketplace.Api.Options;
using ProductMarketplace.Infrastructure.Realtime;

namespace ProductMarketplace.Api.Services;

/// <summary>Only callers who may read the audit trail receive its live feed.</summary>
public class AuditViewerPolicy(IOptions<SelfOptions> self) : IAuditViewerPolicy
{
    public const string Module = "audit";
    public const string Capability = "View";

    public bool CanView(ClaimsPrincipal user) =>
        PlatformPermissions.Evaluate(user, self.Value.AppKey, [(Module, Capability)]) is null;
}
