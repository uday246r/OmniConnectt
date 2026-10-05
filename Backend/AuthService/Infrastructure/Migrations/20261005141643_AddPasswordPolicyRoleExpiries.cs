using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPasswordPolicyRoleExpiries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PasswordPolicyRoleExpiries",
                columns: table => new
                {
                    RoleId = table.Column<Guid>(type: "uuid", nullable: false),
                    ExpiryDays = table.Column<int>(type: "integer", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PasswordPolicyRoleExpiries", x => x.RoleId);
                    table.CheckConstraint("CK_PasswordPolicyRoleExpiries_ExpiryDays", "\"ExpiryDays\" BETWEEN 1 AND 3650");
                    table.ForeignKey(
                        name: "FK_PasswordPolicyRoleExpiries_Roles_RoleId",
                        column: x => x.RoleId,
                        principalTable: "Roles",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            // Overrides used to sit inside PolicyJson. Copy each one that names a role which still exists
            // (the foreign key would refuse the rest), then take the array out of the JSON so the database
            // holds the link in exactly one place. An entry outside 1..3650 is dropped here, not copied: it
            // could only have come from a hand edit, and the policy page never offered it.
            migrationBuilder.Sql(
                """
                INSERT INTO "PasswordPolicyRoleExpiries" ("RoleId", "ExpiryDays", "UpdatedAt", "UpdatedBy")
                SELECT DISTINCT ON (r."Id") r."Id", (e->>'expiryDays')::int, c."UpdatedAt", c."UpdatedBy"
                FROM "PasswordPolicyCatalogs" c
                CROSS JOIN LATERAL jsonb_array_elements(
                    CASE WHEN jsonb_typeof(c."PolicyJson" -> 'roleExpiries') = 'array'
                         THEN c."PolicyJson" -> 'roleExpiries'
                         ELSE '[]'::jsonb END) AS e
                JOIN "Roles" r ON r."Id" = (e->>'roleId')::uuid
                WHERE (e->>'expiryDays') ~ '^[0-9]+$'
                  AND (e->>'expiryDays')::int BETWEEN 1 AND 3650
                ORDER BY r."Id", c."UpdatedAt" DESC;
                """);

            migrationBuilder.Sql(
                """
                UPDATE "PasswordPolicyCatalogs" SET "PolicyJson" = "PolicyJson" - 'roleExpiries'
                WHERE "PolicyJson" ? 'roleExpiries';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Put the overrides back into the JSON first, so rolling back does not silently lose them.
            migrationBuilder.Sql(
                """
                UPDATE "PasswordPolicyCatalogs" c
                SET "PolicyJson" = c."PolicyJson" || jsonb_build_object('roleExpiries', COALESCE(
                    (SELECT jsonb_agg(jsonb_build_object('roleId', p."RoleId", 'expiryDays', p."ExpiryDays"))
                       FROM "PasswordPolicyRoleExpiries" p),
                    '[]'::jsonb));
                """);

            migrationBuilder.DropTable(
                name: "PasswordPolicyRoleExpiries");
        }
    }
}
