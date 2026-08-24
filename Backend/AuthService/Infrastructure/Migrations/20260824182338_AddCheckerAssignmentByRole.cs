using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCheckerAssignmentByRole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_CheckerAssignments_Module_CheckerUserId",
                table: "CheckerAssignments");

            migrationBuilder.AlterColumn<Guid>(
                name: "CheckerUserId",
                table: "CheckerAssignments",
                type: "uuid",
                nullable: true,
                oldClrType: typeof(Guid),
                oldType: "uuid");

            migrationBuilder.AddColumn<Guid>(
                name: "CheckerRoleId",
                table: "CheckerAssignments",
                type: "uuid",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_CheckerRoleId",
                table: "CheckerAssignments",
                column: "CheckerRoleId");

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_Module_CheckerRoleId",
                table: "CheckerAssignments",
                columns: new[] { "Module", "CheckerRoleId" },
                unique: true,
                filter: "\"CheckerRoleId\" IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_Module_CheckerUserId",
                table: "CheckerAssignments",
                columns: new[] { "Module", "CheckerUserId" },
                unique: true,
                filter: "\"CheckerUserId\" IS NOT NULL");

            migrationBuilder.AddCheckConstraint(
                name: "CK_CheckerAssignment_UserOrRole",
                table: "CheckerAssignments",
                sql: "(\"CheckerUserId\" IS NOT NULL AND \"CheckerRoleId\" IS NULL) OR (\"CheckerUserId\" IS NULL AND \"CheckerRoleId\" IS NOT NULL)");

            migrationBuilder.AddForeignKey(
                name: "FK_CheckerAssignments_Roles_CheckerRoleId",
                table: "CheckerAssignments",
                column: "CheckerRoleId",
                principalTable: "Roles",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_CheckerAssignments_Roles_CheckerRoleId",
                table: "CheckerAssignments");

            migrationBuilder.DropIndex(
                name: "IX_CheckerAssignments_CheckerRoleId",
                table: "CheckerAssignments");

            migrationBuilder.DropIndex(
                name: "IX_CheckerAssignments_Module_CheckerRoleId",
                table: "CheckerAssignments");

            migrationBuilder.DropIndex(
                name: "IX_CheckerAssignments_Module_CheckerUserId",
                table: "CheckerAssignments");

            migrationBuilder.DropCheckConstraint(
                name: "CK_CheckerAssignment_UserOrRole",
                table: "CheckerAssignments");

            migrationBuilder.DropColumn(
                name: "CheckerRoleId",
                table: "CheckerAssignments");

            migrationBuilder.AlterColumn<Guid>(
                name: "CheckerUserId",
                table: "CheckerAssignments",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"),
                oldClrType: typeof(Guid),
                oldType: "uuid",
                oldNullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_CheckerAssignments_Module_CheckerUserId",
                table: "CheckerAssignments",
                columns: new[] { "Module", "CheckerUserId" },
                unique: true);
        }
    }
}
