using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ModuleRegistry.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddCapabilityMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "Key",
                table: "RemoteAppCapabilities",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50);

            migrationBuilder.AlterColumn<string>(
                name: "DisplayName",
                table: "RemoteAppCapabilities",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "RemoteAppCapabilities",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            // "Api", not the scaffolded empty string. Every cached row was fetched from a remote that
            // only ever declared endpoint guards, and this cache is what gets relayed to AuthService
            // on the next push — an empty type would arrive there as a value it cannot parse.
            migrationBuilder.AddColumn<string>(
                name: "Type",
                table: "RemoteAppCapabilities",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Api");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Description",
                table: "RemoteAppCapabilities");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "RemoteAppCapabilities");

            migrationBuilder.AlterColumn<string>(
                name: "Key",
                table: "RemoteAppCapabilities",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(150)",
                oldMaxLength: 150);

            migrationBuilder.AlterColumn<string>(
                name: "DisplayName",
                table: "RemoteAppCapabilities",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(200)",
                oldMaxLength: 200);
        }
    }
}
