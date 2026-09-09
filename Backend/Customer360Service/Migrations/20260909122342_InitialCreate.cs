using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace backend.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "audit_logs",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    Timestamp = table.Column<string>(type: "text", nullable: false),
                    User = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Action = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    CustomerName = table.Column<string>(type: "character varying(300)", maxLength: 300, nullable: true),
                    CustomerType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: true),
                    CustomerId = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: true),
                    Field = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_audit_logs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "field_configs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProfileType = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ApiField = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    DisplayLabel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Visible = table.Column<bool>(type: "boolean", nullable: false),
                    Section = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    Sensitive = table.Column<bool>(type: "boolean", nullable: false),
                    MaskingRule = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    VisibleCharCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_field_configs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_Action",
                table: "audit_logs",
                column: "Action");

            migrationBuilder.CreateIndex(
                name: "IX_audit_logs_Timestamp",
                table: "audit_logs",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_field_configs_ProfileType_ApiField",
                table: "field_configs",
                columns: new[] { "ProfileType", "ApiField" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "audit_logs");

            migrationBuilder.DropTable(
                name: "field_configs");
        }
    }
}
