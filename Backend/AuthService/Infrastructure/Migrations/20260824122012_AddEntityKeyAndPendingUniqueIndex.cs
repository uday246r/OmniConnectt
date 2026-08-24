using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddEntityKeyAndPendingUniqueIndex : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EntityKey",
                table: "ApprovalRequests",
                type: "character varying(200)",
                maxLength: 200,
                nullable: true);

            /*
             * Backfill, in two deliberate steps.
             *
             * Duplicate pending requests on the same record were POSSIBLE before this release (there
             * was no application check and no constraint), so this database may already contain rows
             * the new unique index would reject — which would make the migration fail on exactly the
             * installations that most need it.
             *
             * Step 1 backfills every DECIDED row unconditionally: they don't participate in the
             * partial index at all, and a populated key keeps historical rows consistent with new ones.
             *
             * Step 2 backfills only the EARLIEST pending row of each (Module, EntityId) group. Any
             * pre-existing duplicate keeps a NULL key, which the index treats as distinct — so the
             * index builds cleanly, nothing in flight is destroyed, and a checker can still see and
             * resolve the duplicates that already exist. Auto-rejecting them here would discard work a
             * checker may be halfway through reviewing; first-come-first-served matches the rule the
             * application now enforces going forward.
             */
            migrationBuilder.Sql(@"
                UPDATE ""ApprovalRequests"" SET ""EntityKey"" = ""EntityId""
                WHERE ""EntityKey"" IS NULL AND ""EntityId"" IS NOT NULL AND ""Status"" <> 'Pending';
            ");

            migrationBuilder.Sql(@"
                UPDATE ""ApprovalRequests"" SET ""EntityKey"" = ""EntityId""
                WHERE ""Id"" IN (
                    SELECT DISTINCT ON (""Module"", ""EntityId"") ""Id""
                    FROM ""ApprovalRequests""
                    WHERE ""Status"" = 'Pending' AND ""EntityId"" IS NOT NULL
                    ORDER BY ""Module"", ""EntityId"", ""RequestedAt""
                );
            ");

            migrationBuilder.CreateIndex(
                name: "IX_ApprovalRequests_Module_EntityKey",
                table: "ApprovalRequests",
                columns: new[] { "Module", "EntityKey" },
                unique: true,
                filter: "\"Status\" = 'Pending'");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_ApprovalRequests_Module_EntityKey",
                table: "ApprovalRequests");

            migrationBuilder.DropColumn(
                name: "EntityKey",
                table: "ApprovalRequests");
        }
    }
}
