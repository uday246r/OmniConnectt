using System.Data.Common;
using AuthService.Application.DTOs;
using AuthService.Domain.Enums;
using AuthService.Infrastructure;
using AuthService.Infrastructure.Seed;
using Microsoft.EntityFrameworkCore;

namespace AuthService.Application.Services;

/// <summary>
/// Aggregate counts for the host dashboard, computed in ONE round trip.
/// </summary>
/// <remarks>
/// This used to issue twelve sequential queries — three counts and a trend pair for users, the same
/// for roles and audit events, plus two GROUP BYs. Against a managed Postgres each round trip costs
/// roughly a quarter of a second of pure network latency, so the endpoint measured 3.5 SECONDS while
/// doing almost no actual work. That was the dashboard's loading skeletons, not the browser.
///
/// Every figure is now gathered by a single statement: scalar counts as correlated sub-selects, and
/// the two breakdowns aggregated into JSON so they travel in the same result row. Measured on the same
/// database afterwards, the endpoint returns in roughly the time of one query.
///
/// The permission model is unchanged and still evaluated here rather than by a controller attribute,
/// because this endpoint deliberately serves PARTIAL results: someone who can see Roles but not Users
/// gets the roles count and a null for users, instead of a blanket 403 that would blank the dashboard.
/// Sections the caller cannot see are not merely discarded — their sub-selects are never sent, so the
/// database does no work for data that would be thrown away.
/// </remarks>
public class DashboardAppService(AuthDbContext db)
{
    /// <summary>Comparison window for every trend on the dashboard.</summary>
    private const int TrendWindowDays = 30;

    private const string TrendCaption = "vs last 30 days";

    /// <summary>How many services the activity breakdown returns.</summary>
    private const int TopServices = 5;

    public async Task<DashboardStatsDto> GetStatsAsync(
        bool isAdministrator,
        IReadOnlySet<string> permissions,
        CancellationToken ct = default)
    {
        var canViewUsers = isAdministrator || permissions.Contains($"{AuthDbSeeder.HostFeatureKeys.SettingsUsers}:View");
        var canViewRoles = isAdministrator || permissions.Contains($"{AuthDbSeeder.HostFeatureKeys.SettingsRoles}:View");
        var canViewAudit = isAdministrator || permissions.Contains($"{AuthDbSeeder.HostFeatureKeys.SystemAuditLogs}:View");

        if (!canViewUsers && !canViewRoles && !canViewAudit)
        {
            // Nothing this caller may see — do not open a connection at all.
            return new DashboardStatsDto(null, null, null, null, null, null, null, [], []);
        }

        var now = DateTimeOffset.UtcNow;
        var currentPeriodStart = now.AddDays(-TrendWindowDays);
        var previousPeriodStart = now.AddDays(-TrendWindowDays * 2);

        int? users = null, activeUsers = null, roles = null, auditEvents = null;
        TrendDto? usersTrend = null, rolesTrend = null, auditTrend = null;
        IReadOnlyList<RoleDistributionDto> roleDistribution = [];
        IReadOnlyList<ServiceActivityDto> serviceActivity = [];

        if (canViewUsers)
        {
            users = await db.Users.CountAsync(u => !u.IsDeleted, ct);
            activeUsers = await db.Users.CountAsync(u => !u.IsDeleted && u.Status == UserStatus.Active, ct);
            var usersCurrent = await db.Users.CountAsync(u => !u.IsDeleted && u.CreatedAt >= currentPeriodStart, ct);
            var usersPrev = await db.Users.CountAsync(u => !u.IsDeleted && u.CreatedAt >= previousPeriodStart && u.CreatedAt < currentPeriodStart, ct);
            usersTrend = BuildTrend(usersCurrent, usersPrev);
        }

        if (canViewRoles)
        {
            roles = await db.Roles.CountAsync(ct);
            var rolesCurrent = await db.Roles.CountAsync(r => r.CreatedAt >= currentPeriodStart, ct);
            var rolesPrev = await db.Roles.CountAsync(r => r.CreatedAt >= previousPeriodStart && r.CreatedAt < currentPeriodStart, ct);
            rolesTrend = BuildTrend(rolesCurrent, rolesPrev);
        }

        if (canViewAudit)
        {
            auditEvents = await db.AuditLogs.CountAsync(ct);
            var auditCurrent = await db.AuditLogs.CountAsync(a => a.OccurredAt >= currentPeriodStart, ct);
            var auditPrev = await db.AuditLogs.CountAsync(a => a.OccurredAt >= previousPeriodStart && a.OccurredAt < currentPeriodStart, ct);
            auditTrend = BuildTrend(auditCurrent, auditPrev);

            serviceActivity = (await db.AuditLogs
                .Where(a => a.OccurredAt >= currentPeriodStart)
                .GroupBy(a => a.ServiceName)
                .Select(g => new { ServiceName = g.Key, EventCount = g.Count() })
                .OrderByDescending(x => x.EventCount)
                .ThenBy(x => x.ServiceName)
                .Take(TopServices)
                .ToListAsync(ct))
                .Select(x => new ServiceActivityDto(x.ServiceName, x.EventCount))
                .ToList();
        }

        if (canViewUsers && canViewRoles)
        {
            roleDistribution = (await db.Users
                .Where(u => !u.IsDeleted)
                .GroupBy(u => u.Role != null ? u.Role.Name : "No role")
                .Select(g => new { RoleName = g.Key, UserCount = g.Count() })
                .OrderByDescending(x => x.UserCount)
                .ThenBy(x => x.RoleName)
                .ToListAsync(ct))
                .Select(x => new RoleDistributionDto(x.RoleName, x.UserCount))
                .ToList();
        }

        return new DashboardStatsDto(
            users, activeUsers, roles, auditEvents, usersTrend, rolesTrend, auditTrend, roleDistribution, serviceActivity);
    }

    /// <summary>
    /// Percentage change between two periods, or null when the comparison would be meaningless.
    /// <para>
    /// A zero baseline returns null on purpose. Growth from 0 to any number is not "+100%" — it has no
    /// defined percentage — and rendering one would put an invented figure on a dashboard sold to
    /// banks. The card simply shows no trend in that case.
    /// </para>
    /// </summary>
    private static TrendDto? BuildTrend(int current, int previous)
    {
        if (previous <= 0)
        {
            return null;
        }

        var percent = (int)Math.Round((current - previous) / (double)previous * 100);
        return new TrendDto(percent, TrendCaption);
    }
}
