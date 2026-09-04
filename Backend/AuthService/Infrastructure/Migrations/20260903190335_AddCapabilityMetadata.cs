using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <summary>
    /// Adds description, type, grouping and soft-delete to capability rows.
    /// </summary>
    /// <remarks>
    /// The scaffolded version of this migration was not safe and was rewritten by hand. EF defaults a
    /// new non-nullable bit to <c>false</c> and a new non-nullable string to <c>""</c>, which here
    /// would have deactivated every capability in the catalog and given every one of them an
    /// unparseable type — and since the claims builder now mints only active <c>Api</c> capabilities,
    /// the first login after deploying it would have handed every non-administrator an empty
    /// permission set. The backfills below are the whole point of this file: existing rows must come
    /// out of it describing exactly the behaviour they had going in.
    /// </remarks>
    public partial class AddCapabilityMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Widened for dotted keys ("chart.leads-over-time") and the longer human labels that come
            // with declaring business capabilities rather than bare CRUD verbs.
            migrationBuilder.AlterColumn<string>(
                name: "Key",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(150)",
                maxLength: 150,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(50)",
                oldMaxLength: 50);

            migrationBuilder.AlterColumn<string>(
                name: "DisplayName",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(200)",
                maxLength: 200,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(100)",
                oldMaxLength: 100);

            migrationBuilder.AddColumn<string>(
                name: "Description",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(500)",
                maxLength: 500,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "GroupKey",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: true);

            // true, not the scaffolded false: every capability that exists today is one a remote is
            // currently declaring, so all of them stay live.
            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "PermissionFeatureCapabilities",
                type: "bit",
                nullable: false,
                defaultValue: true);

            // "Api", not the scaffolded "": every capability that exists today came from a
            // [RequiresCapability] attribute and is enforced by a filter reading the JWT claim. This
            // value is what keeps them in the token.
            migrationBuilder.AddColumn<string>(
                name: "Type",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(20)",
                maxLength: 20,
                nullable: false,
                defaultValue: "Api");

            // Derive the group from the key's dotted prefix for any row that already has one, so the
            // editor groups consistently without waiting for each remote to re-sync.
            migrationBuilder.Sql(@"
UPDATE [PermissionFeatureCapabilities]
SET [GroupKey] = LEFT([Key], CHARINDEX('.', [Key]) - 1)
WHERE CHARINDEX('.', [Key]) > 1;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Description",
                table: "PermissionFeatureCapabilities");

            migrationBuilder.DropColumn(
                name: "GroupKey",
                table: "PermissionFeatureCapabilities");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "PermissionFeatureCapabilities");

            migrationBuilder.DropColumn(
                name: "Type",
                table: "PermissionFeatureCapabilities");

            // Truncating back to the old widths would fail on any row that used the new room, so the
            // caller has to shorten those first. Nothing here can guess a correct shorter key.
            migrationBuilder.AlterColumn<string>(
                name: "Key",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(50)",
                maxLength: 50,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(150)",
                oldMaxLength: 150);

            migrationBuilder.AlterColumn<string>(
                name: "DisplayName",
                table: "PermissionFeatureCapabilities",
                type: "nvarchar(100)",
                maxLength: 100,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "nvarchar(200)",
                oldMaxLength: 200);
        }
    }
}
