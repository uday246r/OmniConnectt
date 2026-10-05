using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace LeadManagement.Api.Migrations
{
    /// <inheritdoc />
    public partial class ConnectToProductCatalogue : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /*
             * Order matters here, unlike the scaffolded version: the old Products table is read to fill
             * the new snapshot columns BEFORE it is dropped, so no existing lead loses the name of the
             * product it was taken for.
             *
             * What happens to existing data:
             *  - Leads keep their product NAME and CODE (copied from the old Products row). They get no
             *    CatalogProductId / sub-category / category — those products never existed in the
             *    Marketplace — so they read as "taken before the catalogue was connected", stay
             *    listable, searchable and editable, and are grouped by that name on the dashboard.
             *  - LeadFieldConfigs were keyed by the old product ids, which mean nothing to the
             *    Marketplace, so every row is deleted. A sub-category gets a fresh default set the first
             *    time it is used. Field Settings edits made against the old products are NOT carried over.
             */
            migrationBuilder.AddColumn<Guid>(
                name: "CatalogCategoryId",
                table: "Leads",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CatalogProductId",
                table: "Leads",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "CatalogSubCategoryId",
                table: "Leads",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CategoryCode",
                table: "Leads",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "CategoryName",
                table: "Leads",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ProductCode",
                table: "Leads",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ProductName",
                table: "Leads",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SubCategoryCode",
                table: "Leads",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SubCategoryName",
                table: "Leads",
                type: "character varying(200)",
                maxLength: 200,
                nullable: false,
                defaultValue: "");

            migrationBuilder.Sql(
                "UPDATE \"Leads\" SET \"ProductName\" = p.\"Name\", \"ProductCode\" = p.\"Code\" " +
                "FROM \"Products\" p WHERE p.\"Id\" = \"Leads\".\"ProductId\";");

            migrationBuilder.Sql("DELETE FROM \"LeadFieldConfigs\";");

            migrationBuilder.DropForeignKey(
                name: "FK_LeadFieldConfigs_Products_ProductId",
                table: "LeadFieldConfigs");

            migrationBuilder.DropForeignKey(
                name: "FK_Leads_Products_ProductId",
                table: "Leads");

            migrationBuilder.DropTable(
                name: "Products");

            migrationBuilder.DropIndex(
                name: "IX_Leads_ProductId",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "ProductId",
                table: "Leads");

            migrationBuilder.RenameColumn(
                name: "ProductId",
                table: "LeadFieldConfigs",
                newName: "CatalogSubCategoryId");

            migrationBuilder.RenameIndex(
                name: "IX_LeadFieldConfigs_ProductId_ApiField",
                table: "LeadFieldConfigs",
                newName: "IX_LeadFieldConfigs_CatalogSubCategoryId_ApiField");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_CatalogProductId",
                table: "Leads",
                column: "CatalogProductId");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_ProductName",
                table: "Leads",
                column: "ProductName");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Leads_CatalogProductId",
                table: "Leads");

            migrationBuilder.DropIndex(
                name: "IX_Leads_ProductName",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "CatalogCategoryId",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "CatalogProductId",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "CatalogSubCategoryId",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "CategoryCode",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "CategoryName",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "ProductCode",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "ProductName",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "SubCategoryCode",
                table: "Leads");

            migrationBuilder.DropColumn(
                name: "SubCategoryName",
                table: "Leads");

            migrationBuilder.RenameColumn(
                name: "CatalogSubCategoryId",
                table: "LeadFieldConfigs",
                newName: "ProductId");

            migrationBuilder.RenameIndex(
                name: "IX_LeadFieldConfigs_CatalogSubCategoryId_ApiField",
                table: "LeadFieldConfigs",
                newName: "IX_LeadFieldConfigs_ProductId_ApiField");

            migrationBuilder.AddColumn<Guid>(
                name: "ProductId",
                table: "Leads",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.CreateTable(
                name: "Products",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Id);
                });

            migrationBuilder.InsertData(
                table: "Products",
                columns: new[] { "Id", "Code", "IsActive", "Name" },
                values: new object[,]
                {
                    { new Guid("11111111-1111-1111-1111-111111111111"), "ASB", true, "ASB Financing" },
                    { new Guid("22222222-2222-2222-2222-222222222222"), "AUTO", true, "Automobile Financing" },
                    { new Guid("33333333-3333-3333-3333-333333333333"), "HOME", true, "Home Financing" },
                    { new Guid("44444444-4444-4444-4444-444444444444"), "MICRO", true, "Micro Finance" },
                    { new Guid("55555555-5555-5555-5555-555555555555"), "PERSONAL", true, "Personal Financing" },
                    { new Guid("66666666-6666-6666-6666-666666666666"), "SOLAR", true, "Solar Panel Financing" },
                    { new Guid("77777777-7777-7777-7777-777777777777"), "TRAVEL", true, "Umrah/Hajj/Travel Financing" }
                });

            migrationBuilder.CreateIndex(
                name: "IX_Leads_ProductId",
                table: "Leads",
                column: "ProductId");

            migrationBuilder.AddForeignKey(
                name: "FK_LeadFieldConfigs_Products_ProductId",
                table: "LeadFieldConfigs",
                column: "ProductId",
                principalTable: "Products",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Leads_Products_ProductId",
                table: "Leads",
                column: "ProductId",
                principalTable: "Products",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
