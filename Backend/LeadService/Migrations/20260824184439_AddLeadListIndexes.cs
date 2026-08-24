using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LeadManagement.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddLeadListIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Leads_IsDeleted_CreatedAt",
                table: "Leads",
                columns: new[] { "IsDeleted", "CreatedAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_Leads_Status",
                table: "Leads",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Leads_IsDeleted_CreatedAt",
                table: "Leads");

            migrationBuilder.DropIndex(
                name: "IX_Leads_Status",
                table: "Leads");
        }
    }
}
