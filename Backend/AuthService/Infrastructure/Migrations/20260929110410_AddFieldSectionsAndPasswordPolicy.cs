using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddFieldSectionsAndPasswordPolicy : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // An earlier, never-committed draft of the password policy (templates + per-user template
            // assignment) added these objects and, on some development databases, had already been
            // applied before it was replaced by this migration. Clearing them first makes this safe to
            // run whether or not that draft ever touched the database: every statement is a no-op when
            // the object is absent. Nothing here exists in any released schema.
            migrationBuilder.Sql(
                """
                DROP TABLE IF EXISTS "PasswordPolicyTemplateCatalogs";
                ALTER TABLE "Users" DROP COLUMN IF EXISTS "PasswordPolicyTemplateId";
                ALTER TABLE "Users" DROP COLUMN IF EXISTS "PasswordChangedAt";
                """);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "PasswordChangedAt",
                table: "Users",
                type: "timestamp with time zone",
                nullable: true);

            // Rollout grace period. Expiry counts from PasswordChangedAt, falling back to CreatedAt, and
            // the default policy is 90 days — so without this, every account created more than 90 days
            // ago would be locked out on its next sign-in the moment this ships. Starting the clock now
            // for every existing account that already has a password gives everyone a full period.
            // Accounts still on a temporary password (MustChangePassword) keep NULL: they must change it anyway.
            migrationBuilder.Sql(
                """
                UPDATE "Users"
                SET "PasswordChangedAt" = now()
                WHERE "PasswordHash" IS NOT NULL AND "MustChangePassword" = false;
                """);

            migrationBuilder.AddColumn<int>(
                name: "PasswordExpiryReminderSentDay",
                table: "Users",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "FieldSectionCatalogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    SectionsJson = table.Column<string>(type: "jsonb", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FieldSectionCatalogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PasswordPolicyCatalogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    PolicyJson = table.Column<string>(type: "jsonb", nullable: false),
                    Version = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PasswordPolicyCatalogs", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FieldSectionCatalogs");

            migrationBuilder.DropTable(
                name: "PasswordPolicyCatalogs");

            migrationBuilder.DropColumn(
                name: "PasswordChangedAt",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "PasswordExpiryReminderSentDay",
                table: "Users");
        }
    }
}
