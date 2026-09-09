using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ModuleRegistry.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RemoteApps",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IconKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    ManifestUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: false),
                    SidebarOrder = table.Column<int>(type: "integer", nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    MaintenanceMessage = table.Column<string>(type: "character varying(2000)", maxLength: 2000, nullable: true),
                    PermissionFeatureKey = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    PermissionsSourceUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    Health = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    LastHealthCheckAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    LastHealthError = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    ContainerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    CreatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    CreatedBy = table.Column<Guid>(type: "uuid", nullable: true),
                    UpdatedBy = table.Column<Guid>(type: "uuid", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RemoteApps", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RemoteAppCapabilities",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    RemoteAppId = table.Column<Guid>(type: "uuid", nullable: false),
                    ModuleKey = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    ModuleDisplayName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Key = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    DisplayName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    Type = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RemoteAppCapabilities", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RemoteAppCapabilities_RemoteApps_RemoteAppId",
                        column: x => x.RemoteAppId,
                        principalTable: "RemoteApps",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RemoteAppCapabilities_RemoteAppId_ModuleKey_Key",
                table: "RemoteAppCapabilities",
                columns: new[] { "RemoteAppId", "ModuleKey", "Key" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteApps_Key",
                table: "RemoteApps",
                column: "Key",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteApps_PermissionFeatureKey",
                table: "RemoteApps",
                column: "PermissionFeatureKey",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RemoteApps_Status_SidebarOrder",
                table: "RemoteApps",
                columns: new[] { "Status", "SidebarOrder" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RemoteAppCapabilities");

            migrationBuilder.DropTable(
                name: "RemoteApps");
        }
    }
}
