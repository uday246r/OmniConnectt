using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProductMarketplace.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddIsReadOnlyToFieldDefinition : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<bool>(
                name: "IsReadOnly",
                table: "FieldDefinitions",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsReadOnly",
                table: "FieldDefinitions");
        }
    }
}
