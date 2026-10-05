using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddReleaseRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "ReleaseRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Key = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Version = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ManifestUrl = table.Column<string>(type: "character varying(2048)", maxLength: 2048, nullable: true),
                    ContainerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                    RequiredHostBridge = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    BridgeVersion = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                    Checksum = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: true),
                    ReleaseId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: true),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    RegisteredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    PromotedAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    PromotedBy = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ReleaseRecords", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ReleaseRecords_Key_Live",
                table: "ReleaseRecords",
                column: "Key",
                unique: true,
                filter: "\"Status\" = 'Live'");

            migrationBuilder.CreateIndex(
                name: "IX_ReleaseRecords_Key_Version",
                table: "ReleaseRecords",
                columns: new[] { "Key", "Version" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ReleaseRecords");
        }
    }
}
