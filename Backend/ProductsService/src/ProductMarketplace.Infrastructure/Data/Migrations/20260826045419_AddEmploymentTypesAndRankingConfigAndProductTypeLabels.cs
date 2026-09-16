using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProductMarketplace.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEmploymentTypesAndRankingConfigAndProductTypeLabels : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "AmountFieldLabel",
                table: "ProductTypes",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ApplyButtonLabel",
                table: "ProductTypes",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ShortLabel",
                table: "ProductTypes",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "EmploymentTypes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "text", nullable: false),
                    Active = table.Column<bool>(type: "boolean", nullable: false),
                    SortOrder = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EmploymentTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "RankingConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    TrendingViewWeight = table.Column<double>(type: "double precision", nullable: false),
                    TrendingApplicationWeight = table.Column<double>(type: "double precision", nullable: false),
                    RecommendedRatingWeight = table.Column<double>(type: "double precision", nullable: false),
                    RecommendedApplicationWeight = table.Column<double>(type: "double precision", nullable: false),
                    RecommendedPromotionWeight = table.Column<double>(type: "double precision", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RankingConfigs", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EmploymentTypes");

            migrationBuilder.DropTable(
                name: "RankingConfigs");

            migrationBuilder.DropColumn(
                name: "AmountFieldLabel",
                table: "ProductTypes");

            migrationBuilder.DropColumn(
                name: "ApplyButtonLabel",
                table: "ProductTypes");

            migrationBuilder.DropColumn(
                name: "ShortLabel",
                table: "ProductTypes");
        }
    }
}
