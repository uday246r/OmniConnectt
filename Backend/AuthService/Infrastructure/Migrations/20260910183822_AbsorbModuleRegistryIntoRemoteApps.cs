using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <summary>
    /// Turns the replicated <c>RemoteAppNavMetadata</c> into <c>RemoteApps</c>, the registration table
    /// AuthDb now owns outright, and drops the dead SQL Server <c>RowVersion</c> column.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Hand-edited away from the scaffolded drop-and-create. The generated version would have deleted
    /// every registered remote app: it sees a table disappearing and another appearing, not the same
    /// rows gaining columns. A rename preserves the rows, the primary key and the cascade, and is a
    /// metadata-only operation on Postgres — no table rewrite, no long lock.
    /// </para>
    /// <para>
    /// <c>PermissionsSourceUrl</c> is the one column with nowhere to come from: it only ever existed in
    /// the Module Registry's own database, which this migration cannot reach. It is left null and
    /// restored for the platform's two built-in apps by <c>RemoteAppSeeder</c>; any third-party app
    /// needs an administrator to re-enter it. Nothing breaks in the meantime — a null source URL means
    /// "declares nothing", and the capability rows already in the catalog are left untouched.
    /// </para>
    /// </remarks>
    public partial class AbsorbModuleRegistryIntoRemoteApps : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Pre-flight. ContainerName gains a UNIQUE index below, and duplicates are genuinely
            // possible in existing data: the old clash check ran only when an app was first registered,
            // never on edit, and the health probe overwrote the column on every successful sweep with
            // no check at all. Failing here names the offending apps; failing on the index would
            // surface as a bare constraint violation with no indication of which rows to fix.
            migrationBuilder.Sql("""
                DO $$
                DECLARE clashing text;
                BEGIN
                    SELECT string_agg(DISTINCT "ContainerName", ', ')
                      INTO clashing
                      FROM (
                        SELECT "ContainerName"
                          FROM "RemoteAppNavMetadata"
                         WHERE "ContainerName" IS NOT NULL
                         GROUP BY "ContainerName"
                        HAVING count(*) > 1
                      ) d;

                    IF clashing IS NOT NULL THEN
                        RAISE EXCEPTION
                            'Two or more remote apps share a Module Federation container name (%). '
                            'A container name is a global identifier in the browser, so this has been '
                            'broken at runtime already. Give each app a distinct federation name, '
                            'update the affected rows, then re-run this migration.', clashing;
                    END IF;
                END $$;
                """);

            migrationBuilder.RenameTable(
                name: "RemoteAppNavMetadata",
                newName: "RemoteApps");

            // RenameTable leaves constraint names behind, and EF's model snapshot expects the new
            // ones — a later migration that touches them would not find them otherwise.
            migrationBuilder.Sql("""
                ALTER TABLE "RemoteApps" RENAME CONSTRAINT "PK_RemoteAppNavMetadata" TO "PK_RemoteApps";
                ALTER TABLE "RemoteApps" RENAME CONSTRAINT "FK_RemoteAppNavMetadata_PermissionFeatures_FeatureId"
                    TO "FK_RemoteApps_PermissionFeatures_FeatureId";
                """);

            // Nullable for now; Key is tightened to NOT NULL once the backfill below has populated it.
            migrationBuilder.AddColumn<string>(
                name: "Key",
                table: "RemoteApps",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PermissionsSourceUrl",
                table: "RemoteApps",
                type: "character varying(2048)",
                maxLength: 2048,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Health",
                table: "RemoteApps",
                type: "character varying(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Unknown");

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "LastHealthCheckAt",
                table: "RemoteApps",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LastHealthError",
                table: "RemoteApps",
                type: "character varying(1000)",
                maxLength: 1000,
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "CreatedAt",
                table: "RemoteApps",
                type: "timestamp with time zone",
                nullable: false,
                defaultValueSql: "now()");

            migrationBuilder.AddColumn<Guid>(
                name: "CreatedBy",
                table: "RemoteApps",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "UpdatedBy",
                table: "RemoteApps",
                type: "uuid",
                nullable: true);

            // A metadata row whose feature is missing, or is not a remote app, has no derivable Key —
            // it is not navigation and never was. The first case cannot occur (the FK cascades), the
            // second only if something wrote metadata for a host feature. Removed rather than left to
            // fail the NOT NULL below with nothing to say about why.
            migrationBuilder.Sql("""
                DELETE FROM "RemoteApps" a
                 WHERE NOT EXISTS (
                    SELECT 1 FROM "PermissionFeatures" f
                     WHERE f."Id" = a."FeatureId" AND f."Key" LIKE 'remote.%');
                """);

            // The app key is the feature key without the platform's "remote." prefix (7 characters;
            // Postgres substring is 1-indexed, so the remainder starts at 8). DisplayName and
            // SidebarOrder are deliberately NOT copied across — they stay on PermissionFeatures, which
            // is where the navigation tree already reads them from.
            migrationBuilder.Sql("""
                UPDATE "RemoteApps" a
                   SET "Key"       = substring(f."Key" from 8),
                       "CreatedAt" = f."CreatedAt"
                  FROM "PermissionFeatures" f
                 WHERE f."Id" = a."FeatureId";
                """);

            migrationBuilder.AlterColumn<string>(
                name: "Key",
                table: "RemoteApps",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(100)",
                oldMaxLength: 100,
                oldNullable: true);

            // The two defaults above exist only to give the existing rows a value during this
            // migration. The EF model declares neither, so leaving them in place would show up as
            // model drift on the next scaffold — and both columns are always written explicitly by
            // the application anyway.
            migrationBuilder.Sql("""
                ALTER TABLE "RemoteApps" ALTER COLUMN "Health" DROP DEFAULT;
                ALTER TABLE "RemoteApps" ALTER COLUMN "CreatedAt" DROP DEFAULT;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteApps_Key",
                table: "RemoteApps",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteApps_ContainerName",
                table: "RemoteApps",
                column: "ContainerName",
                unique: true,
                filter: "\"ContainerName\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_RemoteApps_Status",
                table: "RemoteApps",
                column: "Status");

            // Dead since the move off SQL Server. The live concurrency token on ApprovalRequests is
            // Postgres's own xmin system column, configured in AuthDbContext; this byte[] was mapped by
            // convention, written by nothing, and read by nothing.
            migrationBuilder.DropColumn(
                name: "RowVersion",
                table: "ApprovalRequests");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<byte[]>(
                name: "RowVersion",
                table: "ApprovalRequests",
                type: "bytea",
                nullable: true);

            migrationBuilder.DropIndex(name: "IX_RemoteApps_Status", table: "RemoteApps");
            migrationBuilder.DropIndex(name: "IX_RemoteApps_ContainerName", table: "RemoteApps");
            migrationBuilder.DropIndex(name: "IX_RemoteApps_Key", table: "RemoteApps");

            // The columns added above are dropped, so their contents are lost on a down-migration —
            // PermissionsSourceUrl included. That is unavoidable: the table they came from no longer
            // exists to receive them.
            migrationBuilder.DropColumn(name: "UpdatedBy", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "CreatedBy", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "CreatedAt", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "LastHealthError", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "LastHealthCheckAt", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "Health", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "PermissionsSourceUrl", table: "RemoteApps");
            migrationBuilder.DropColumn(name: "Key", table: "RemoteApps");

            migrationBuilder.Sql("""
                ALTER TABLE "RemoteApps" RENAME CONSTRAINT "PK_RemoteApps" TO "PK_RemoteAppNavMetadata";
                ALTER TABLE "RemoteApps" RENAME CONSTRAINT "FK_RemoteApps_PermissionFeatures_FeatureId"
                    TO "FK_RemoteAppNavMetadata_PermissionFeatures_FeatureId";
                """);

            migrationBuilder.RenameTable(
                name: "RemoteApps",
                newName: "RemoteAppNavMetadata");
        }
    }
}
