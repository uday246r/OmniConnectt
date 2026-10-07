using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <summary>
    /// Data only — no schema change.
    ///
    /// Checker Assignment stopped offering features whose capabilities are all reads (Audit Logs,
    /// System Logs, the dashboards): maker-checker holds a change until someone approves it, and
    /// those have no change to hold. Filtering the picker is not enough on its own, because
    /// <c>ApprovalGatingService.IsGatedAsync</c> asks only whether a row exists for the module and
    /// never consults the assignable list. An assignment made before this would therefore have gone
    /// on gating invisibly — present in the database, absent from every screen.
    ///
    /// The predicate is evaluated against the catalog as it stands when this runs rather than against
    /// a hardcoded list of keys, so a remote app's own read-only modules are covered too without this
    /// file having to know their names. It mirrors
    /// <c>CheckerAssignmentAppService.MutatingCapabilities</c>; if a verb is added there, add it here.
    ///
    /// Not reversible: Down cannot invent rows back, and a row this deletes could never have had an
    /// effect anyway.
    /// </summary>
    public partial class ClearCheckerAssignmentsForReadOnlyModules : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Scoped to modules that DO have a feature and whose capabilities are all reads. A row whose
            // module matches no feature at all is something else — a remote that was removed outright —
            // and is left alone rather than swept up by a migration aimed at a different problem.
            //
            // Feature."IsActive" is deliberately not tested: deactivating an app hides its modules from
            // the picker and is documented as NOT deleting their assignments, so that a reactivated app
            // comes back configured as it was.
            migrationBuilder.Sql(
                """
                DELETE FROM "CheckerAssignments" ca
                WHERE EXISTS (
                        SELECT 1 FROM "PermissionFeatures" f WHERE f."Key" = ca."Module"
                      )
                  AND NOT EXISTS (
                        SELECT 1
                        FROM "PermissionFeatures" f
                        JOIN "PermissionFeatureCapabilities" c ON c."FeatureId" = f."Id"
                        WHERE f."Key" = ca."Module"
                          AND c."IsActive"
                          AND POSITION('.' IN c."Key") = 0
                          AND UPPER(c."Key") IN (
                                'CREATE', 'EDIT', 'UPDATE', 'DELETE',
                                'DISABLE', 'ENABLE', 'REGISTER', 'MANAGE'
                              )
                      );
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Deliberately empty: the deleted rows cannot be reconstructed, and none of them could
            // gate anything, so there is nothing to restore.
        }
    }
}
