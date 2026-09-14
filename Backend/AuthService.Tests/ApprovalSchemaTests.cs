using AuthService.Domain.Entities;
using AuthService.Infrastructure;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Xunit;

namespace AuthService.Tests;

/// <summary>
/// The guarantees the database provides, asserted where they are declared.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="ApprovalConcurrencyTests"/> proves the application handles a concurrency violation and
/// a unique-key violation correctly. It cannot prove that Postgres ever RAISES them, because the
/// in-memory provider enforces neither indexes nor concurrency tokens — so a green run there is
/// entirely compatible with someone having quietly dropped the index the handler exists to catch.
/// </para>
/// <para>
/// These tests close that gap from the other end. They assert the model configuration: that the
/// index exists, that it is filtered to Pending rows only, that <c>xmin</c> is mapped as a
/// concurrency token, that the check constraint is declared. None of them touches a database; all of
/// them fail loudly the moment the configuration that makes the concurrency handling meaningful is
/// removed.
/// </para>
/// <para>
/// This is deliberately not a substitute for an integration test against Postgres, which this
/// environment cannot run. It is the strongest available check that the two halves — the constraint
/// and the code that catches its violation — have not drifted apart.
/// </para>
/// </remarks>
public class ApprovalSchemaTests : IDisposable
{
    private readonly AuthDbContext db = TestDb.Create("approval-schema");

    public void Dispose()
    {
        db.Dispose();
        GC.SuppressFinalize(this);
    }

    /// <summary>
    /// One open request per record, enforced by the database rather than only by the check in
    /// SubmitAsync — which cannot close the window between its own read and the insert.
    /// </summary>
    [Fact]
    public void One_pending_request_per_record_is_enforced_by_a_partial_unique_index()
    {
        var entity = db.Model.FindEntityType(typeof(ApprovalRequest))!;

        var index = entity.GetIndexes().SingleOrDefault(i =>
            i.Properties.Select(p => p.Name).SequenceEqual(new[]
            {
                nameof(ApprovalRequest.Module),
                nameof(ApprovalRequest.EntityKey),
            }));

        Assert.NotNull(index);
        Assert.True(index.IsUnique, "The (Module, EntityKey) index must be unique or duplicate requests are possible.");

        // Filtered, and specifically to Pending. Without the filter a record could only ever be
        // changed ONCE in its lifetime, because a decided request would keep blocking new ones.
        var filter = index.GetFilter();
        Assert.NotNull(filter);
        Assert.Contains("Status", filter);
        Assert.Contains("Pending", filter);
    }

    /// <summary>
    /// The claim that makes two simultaneous approvals resolve to one. Without the token both UPDATEs
    /// succeed, both replays run, and the mutation is applied twice.
    /// </summary>
    [Fact]
    public void An_approval_request_carries_a_concurrency_token()
    {
        var entity = db.Model.FindEntityType(typeof(ApprovalRequest))!;

        var token = entity.GetProperties().SingleOrDefault(p => p.IsConcurrencyToken);

        Assert.NotNull(token);
        // Postgres' own system column, so the guarantee costs no schema of our own — but that also
        // means a provider change silently removes it, which is exactly what this pins.
        Assert.Equal("xmin", token.GetColumnName());
    }

    /// <summary>
    /// A checker assignment names a user or a role, never both and never neither. The application
    /// guards it too, but a half-populated row written any other way would make checker selection
    /// resolve to nobody with no error.
    /// </summary>
    [Fact]
    public void A_checker_assignment_must_target_exactly_one_of_a_user_or_a_role()
    {
        // Check constraints are not carried on the runtime model, which is trimmed to what queries
        // need — they only exist on the design-time model the migration pipeline reads.
        var designTimeModel = db.GetService<IDesignTimeModel>().Model;
        var entity = designTimeModel.FindEntityType(typeof(CheckerAssignment))!;

        var constraint = Assert.Single(entity.GetCheckConstraints());
        Assert.Equal("CK_CheckerAssignment_UserOrRole", constraint.Name);
        Assert.Contains("CheckerUserId", constraint.Sql);
        Assert.Contains("CheckerRoleId", constraint.Sql);
    }

    /// <summary>
    /// One assignment per checker per module, for users and roles separately. Both indexes are
    /// filtered because the other column is null on any given row, and an unfiltered unique index
    /// over a nullable column would collide every row whose value is null on Postgres' NULL rules —
    /// or not collide at all, depending on the version. Filtering makes it unambiguous.
    /// </summary>
    [Fact]
    public void A_checker_can_only_be_assigned_to_a_module_once()
    {
        var entity = db.Model.FindEntityType(typeof(CheckerAssignment))!;

        foreach (var column in new[] { nameof(CheckerAssignment.CheckerUserId), nameof(CheckerAssignment.CheckerRoleId) })
        {
            var index = entity.GetIndexes().SingleOrDefault(i =>
                i.Properties.Select(p => p.Name).SequenceEqual(new[] { nameof(CheckerAssignment.Module), column }));

            Assert.True(index is not null, $"No (Module, {column}) index is configured.");
            Assert.True(index!.IsUnique, $"The (Module, {column}) index must be unique.");
            Assert.Contains(column, index.GetFilter() ?? string.Empty);
        }
    }

    /// <summary>
    /// The audit trail's own read paths, which the Audit Logs page depends on for anything other than
    /// a full scan. Not a correctness guarantee like the ones above — a missing index makes the
    /// screen slow rather than wrong — but the facets endpoint runs six DISTINCTs per page load, and
    /// the difference between an index and a sequential scan there is the difference between a
    /// dropdown and a timeout.
    /// </summary>
    [Fact]
    public void The_columns_the_audit_facets_query_groups_by_are_indexed()
    {
        var entity = db.Model.FindEntityType(typeof(AuditLog))!;
        var indexedColumns = entity.GetIndexes()
            .Select(i => i.Properties[0].Name)
            .ToHashSet();

        foreach (var column in new[]
                 {
                     nameof(AuditLog.OccurredAt),
                     nameof(AuditLog.ServiceName),
                     nameof(AuditLog.Action),
                     nameof(AuditLog.ActorUserId),
                     nameof(AuditLog.SourceApplication),
                     nameof(AuditLog.ActionCategory),
                 })
        {
            Assert.True(indexedColumns.Contains(column), $"AuditLog.{column} is filtered or grouped on and is not indexed.");
        }
    }

    /// <summary>
    /// A source-level assertion, which is unusual and worth justifying.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The remote-replay guard exists because an HTTP POST to another service's database is outside
    /// this transaction's rollback: if the execution strategy retries the unit, re-sending it would
    /// apply the remote mutation twice. The guard prevents that only because it is declared OUTSIDE
    /// the retried delegate — a flag captured inside would be reconstructed on every attempt and
    /// prevent nothing.
    /// </para>
    /// <para>
    /// That property cannot be observed by calling the method: the in-memory provider's execution
    /// strategy never retries, so the second attempt this guards against is unreachable in any test
    /// this environment can run. The choice is between asserting the declaration site and asserting
    /// nothing. Reading the source is the weaker of the two techniques and the stronger of the two
    /// options, and it fails exactly when someone moves the declaration — which is the mistake.
    /// </para>
    /// </remarks>
    [Fact]
    public void The_remote_replay_guard_is_declared_outside_the_retried_delegate()
    {
        var source = File.ReadAllText(Path.Combine(
            RepoRoot(), "Backend", "AuthService", "Application", "Services", "ApprovalAppService.cs"));

        var guardDeclaration = source.IndexOf("var remoteReplay = new RemoteReplayGuard();", StringComparison.Ordinal);
        var strategyStart = source.IndexOf("CreateExecutionStrategy()", StringComparison.Ordinal);

        Assert.True(guardDeclaration >= 0, "The remote replay guard has been renamed or removed.");
        Assert.True(strategyStart >= 0, "The approval no longer runs inside an execution strategy.");
        Assert.True(
            guardDeclaration < strategyStart,
            "RemoteReplayGuard must be declared BEFORE the execution strategy so it survives a retry. " +
            "Declared inside the retried delegate it is recreated on every attempt and cannot stop a " +
            "duplicate remote replay.");
    }

    /// <summary>
    /// Walks up from the test binary looking for the repository root, the same way the other
    /// source-scanning test in this suite locates it. Fails with a clear message rather than a null
    /// reference if the layout changes.
    /// </summary>
    /// <remarks>
    /// This is also why <c>dotnet test -o</c> must point somewhere INSIDE the repository: redirect
    /// the output to a temp directory elsewhere and the walk never finds a sibling <c>Backend</c>
    /// folder, so this fails on a false negative rather than on anything real.
    /// </remarks>
    private static string RepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "Backend")))
        {
            directory = directory.Parent;
        }

        Assert.True(directory is not null, "Could not locate the repository root from the test output directory.");
        return directory!.FullName;
    }
}
