using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

#pragma warning disable CA1814 // Prefer jagged arrays over multidimensional

namespace LeadManagement.Api.Migrations
{
    /// <inheritdoc />
    public partial class InitialCreate : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AuditLogs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Timestamp = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UserId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    UserName = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    UserRole = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    ActionType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    EntityId = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Description = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: false),
                    Reason = table.Column<string>(type: "text", nullable: true),
                    PreviousValues = table.Column<string>(type: "text", nullable: true),
                    NewValues = table.Column<string>(type: "text", nullable: true),
                    IpAddress = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Status = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AuditLogs", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "EntityTypes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EntityTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "Products",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Products", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PropertyStatuses",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PropertyStatuses", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "PropertyTypes",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PropertyTypes", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "SalesExecutives",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StaffId = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    Email = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_SalesExecutives", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "States",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    Name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_States", x => x.Id);
                });

            migrationBuilder.CreateTable(
                name: "LeadFieldConfigs",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    ApiField = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    DisplayLabel = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    Section = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    DisplayOrder = table.Column<int>(type: "integer", nullable: false),
                    Visible = table.Column<bool>(type: "boolean", nullable: false),
                    Required = table.Column<bool>(type: "boolean", nullable: false),
                    Editable = table.Column<bool>(type: "boolean", nullable: false),
                    Sensitive = table.Column<bool>(type: "boolean", nullable: false),
                    MaskingRule = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: false),
                    VisibleCharCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeadFieldConfigs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeadFieldConfigs_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "Branches",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    StateId = table.Column<Guid>(type: "uuid", nullable: false),
                    Code = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    Name = table.Column<string>(type: "character varying(150)", maxLength: 150, nullable: false),
                    IsActive = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Branches", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Branches_States_StateId",
                        column: x => x.StateId,
                        principalTable: "States",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "Leads",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeadReference = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CustomerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    IcNumber = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    PhoneCountryCode = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    PhoneNumber = table.Column<string>(type: "character varying(30)", maxLength: 30, nullable: false),
                    Email = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ProductId = table.Column<Guid>(type: "uuid", nullable: false),
                    StateId = table.Column<Guid>(type: "uuid", nullable: false),
                    BranchId = table.Column<Guid>(type: "uuid", nullable: true),
                    EmployerName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    AppliedAmount = table.Column<decimal>(type: "numeric(18,2)", nullable: false),
                    HasPreferredSalesExecutive = table.Column<bool>(type: "boolean", nullable: false),
                    PreferredSalesExecutiveId = table.Column<Guid>(type: "uuid", nullable: true),
                    Status = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    IsDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Leads", x => x.Id);
                    table.ForeignKey(
                        name: "FK_Leads_Branches_BranchId",
                        column: x => x.BranchId,
                        principalTable: "Branches",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Leads_Products_ProductId",
                        column: x => x.ProductId,
                        principalTable: "Products",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_Leads_SalesExecutives_PreferredSalesExecutiveId",
                        column: x => x.PreferredSalesExecutiveId,
                        principalTable: "SalesExecutives",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_Leads_States_StateId",
                        column: x => x.StateId,
                        principalTable: "States",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LeadConsentDetails",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: false),
                    MarketingConsent = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    AgreedToPrivacyPolicy = table.Column<bool>(type: "boolean", nullable: false),
                    ConsentedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeadConsentDetails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeadConsentDetails_Leads_LeadId",
                        column: x => x.LeadId,
                        principalTable: "Leads",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LeadHomeFinancingDetails",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: false),
                    PropertyType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    PropertyStatus = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeadHomeFinancingDetails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeadHomeFinancingDetails_Leads_LeadId",
                        column: x => x.LeadId,
                        principalTable: "Leads",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "LeadMicrofinanceDetails",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    LeadId = table.Column<Guid>(type: "uuid", nullable: false),
                    DateOfIncorporation = table.Column<string>(type: "character varying(50)", maxLength: 50, nullable: false),
                    CompanyName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    EntityType = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_LeadMicrofinanceDetails", x => x.Id);
                    table.ForeignKey(
                        name: "FK_LeadMicrofinanceDetails_Leads_LeadId",
                        column: x => x.LeadId,
                        principalTable: "Leads",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.InsertData(
                table: "EntityTypes",
                columns: new[] { "Id", "Name" },
                values: new object[,]
                {
                    { new Guid("f0000000-0000-0000-0000-000000000001"), "Business with SSM" },
                    { new Guid("f0000000-0000-0000-0000-000000000002"), "Professional Body" },
                    { new Guid("f0000000-0000-0000-0000-000000000003"), "Sabah Sarawak Registration" }
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

            migrationBuilder.InsertData(
                table: "PropertyStatuses",
                columns: new[] { "Id", "Name" },
                values: new object[,]
                {
                    { new Guid("e0000000-0000-0000-0000-000000000001"), "Completed" },
                    { new Guid("e0000000-0000-0000-0000-000000000002"), "Under Construction" }
                });

            migrationBuilder.InsertData(
                table: "PropertyTypes",
                columns: new[] { "Id", "Name" },
                values: new object[,]
                {
                    { new Guid("d0000000-0000-0000-0000-000000000001"), "Apartment" },
                    { new Guid("d0000000-0000-0000-0000-000000000002"), "Bungalow" },
                    { new Guid("d0000000-0000-0000-0000-000000000003"), "Condominium" },
                    { new Guid("d0000000-0000-0000-0000-000000000004"), "Terrace" }
                });

            migrationBuilder.InsertData(
                table: "SalesExecutives",
                columns: new[] { "Id", "Email", "IsActive", "Name", "StaffId" },
                values: new object[,]
                {
                    { new Guid("c0000000-0000-0000-0000-000000000001"), "azman.ibrahim@bank.com", true, "Azman bin Ibrahim (Staff ID: SE-1001)", "SE-1001" },
                    { new Guid("c0000000-0000-0000-0000-000000000002"), "noraini.razak@bank.com", true, "Noraini binti Razak (Staff ID: SE-1002)", "SE-1002" },
                    { new Guid("c0000000-0000-0000-0000-000000000003"), "kevin.tan@bank.com", true, "Kevin Tan (Staff ID: SE-1003)", "SE-1003" },
                    { new Guid("c0000000-0000-0000-0000-000000000004"), "saraswathy.r@bank.com", true, "Saraswathy a/p Ramasamy (Staff ID: SE-1004)", "SE-1004" }
                });

            migrationBuilder.InsertData(
                table: "States",
                columns: new[] { "Id", "Code", "Name" },
                values: new object[,]
                {
                    { new Guid("a0000000-0000-0000-0000-000000000001"), "KUL", "KUALA LUMPUR" },
                    { new Guid("a0000000-0000-0000-0000-000000000002"), "SGL", "SELANGOR" },
                    { new Guid("a0000000-0000-0000-0000-000000000003"), "JHR", "JOHOR" },
                    { new Guid("a0000000-0000-0000-0000-000000000004"), "PNG", "PULAU PINANG" },
                    { new Guid("a0000000-0000-0000-0000-000000000005"), "PRK", "PERAK" },
                    { new Guid("a0000000-0000-0000-0000-000000000006"), "KDH", "KEDAH" },
                    { new Guid("a0000000-0000-0000-0000-000000000007"), "MLK", "MELAKA" },
                    { new Guid("a0000000-0000-0000-0000-000000000008"), "NSN", "N.SEMBILAN" },
                    { new Guid("a0000000-0000-0000-0000-000000000009"), "PHG", "PAHANG" },
                    { new Guid("a0000000-0000-0000-0000-000000000010"), "KTN", "KELANTAN" },
                    { new Guid("a0000000-0000-0000-0000-000000000011"), "SWK", "SARAWAK" },
                    { new Guid("a0000000-0000-0000-0000-000000000012"), "SBH", "SABAH" },
                    { new Guid("a0000000-0000-0000-0000-000000000013"), "TRG", "TERENGGANU" }
                });

            migrationBuilder.InsertData(
                table: "Branches",
                columns: new[] { "Id", "Code", "IsActive", "Name", "StateId" },
                values: new object[,]
                {
                    { new Guid("b0000000-0000-0000-0000-000000000001"), "KL01", true, "Kuala Lumpur Main Branch", new Guid("a0000000-0000-0000-0000-000000000001") },
                    { new Guid("b0000000-0000-0000-0000-000000000002"), "KL02", true, "Bangsar Financial Centre", new Guid("a0000000-0000-0000-0000-000000000001") },
                    { new Guid("b0000000-0000-0000-0000-000000000003"), "SL01", true, "Shah Alam Central Branch", new Guid("a0000000-0000-0000-0000-000000000002") },
                    { new Guid("b0000000-0000-0000-0000-000000000004"), "SL02", true, "Petaling Jaya Branch", new Guid("a0000000-0000-0000-0000-000000000002") },
                    { new Guid("b0000000-0000-0000-0000-000000000005"), "JH01", true, "Johor Bahru Main Hub", new Guid("a0000000-0000-0000-0000-000000000003") },
                    { new Guid("b0000000-0000-0000-0000-000000000006"), "PN01", true, "Georgetown Branch", new Guid("a0000000-0000-0000-0000-000000000004") },
                    { new Guid("b0000000-0000-0000-0000-000000000007"), "PK01", true, "Ipoh Central Branch", new Guid("a0000000-0000-0000-0000-000000000005") },
                    { new Guid("b0000000-0000-0000-0000-000000000008"), "KD01", true, "Alor Setar Branch", new Guid("a0000000-0000-0000-0000-000000000006") },
                    { new Guid("b0000000-0000-0000-0000-000000000009"), "MK01", true, "Melaka Raya Branch", new Guid("a0000000-0000-0000-0000-000000000007") },
                    { new Guid("b0000000-0000-0000-0000-000000000010"), "NS01", true, "Seremban Branch", new Guid("a0000000-0000-0000-0000-000000000008") },
                    { new Guid("b0000000-0000-0000-0000-000000000011"), "PH01", true, "Kuantan Branch", new Guid("a0000000-0000-0000-0000-000000000009") },
                    { new Guid("b0000000-0000-0000-0000-000000000012"), "KT01", true, "Kota Bharu Branch", new Guid("a0000000-0000-0000-0000-000000000010") },
                    { new Guid("b0000000-0000-0000-0000-000000000013"), "SK01", true, "Kuching Main Branch", new Guid("a0000000-0000-0000-0000-000000000011") },
                    { new Guid("b0000000-0000-0000-0000-000000000014"), "SB01", true, "Kota Kinabalu Branch", new Guid("a0000000-0000-0000-0000-000000000012") }
                });

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_ActionType",
                table: "AuditLogs",
                column: "ActionType");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_EntityId",
                table: "AuditLogs",
                column: "EntityId");

            migrationBuilder.CreateIndex(
                name: "IX_AuditLogs_Timestamp",
                table: "AuditLogs",
                column: "Timestamp");

            migrationBuilder.CreateIndex(
                name: "IX_Branches_StateId",
                table: "Branches",
                column: "StateId");

            migrationBuilder.CreateIndex(
                name: "IX_LeadConsentDetails_LeadId",
                table: "LeadConsentDetails",
                column: "LeadId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LeadFieldConfigs_ProductId_ApiField",
                table: "LeadFieldConfigs",
                columns: new[] { "ProductId", "ApiField" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LeadHomeFinancingDetails_LeadId",
                table: "LeadHomeFinancingDetails",
                column: "LeadId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_LeadMicrofinanceDetails_LeadId",
                table: "LeadMicrofinanceDetails",
                column: "LeadId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Leads_BranchId",
                table: "Leads",
                column: "BranchId");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_CreatedAt",
                table: "Leads",
                column: "CreatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_CustomerName",
                table: "Leads",
                column: "CustomerName");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_IcNumber",
                table: "Leads",
                column: "IcNumber");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_IsDeleted_CreatedAt",
                table: "Leads",
                columns: new[] { "IsDeleted", "CreatedAt" },
                descending: new[] { false, true });

            migrationBuilder.CreateIndex(
                name: "IX_Leads_PreferredSalesExecutiveId",
                table: "Leads",
                column: "PreferredSalesExecutiveId");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_ProductId",
                table: "Leads",
                column: "ProductId");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_StateId",
                table: "Leads",
                column: "StateId");

            migrationBuilder.CreateIndex(
                name: "IX_Leads_Status",
                table: "Leads",
                column: "Status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AuditLogs");

            migrationBuilder.DropTable(
                name: "EntityTypes");

            migrationBuilder.DropTable(
                name: "LeadConsentDetails");

            migrationBuilder.DropTable(
                name: "LeadFieldConfigs");

            migrationBuilder.DropTable(
                name: "LeadHomeFinancingDetails");

            migrationBuilder.DropTable(
                name: "LeadMicrofinanceDetails");

            migrationBuilder.DropTable(
                name: "PropertyStatuses");

            migrationBuilder.DropTable(
                name: "PropertyTypes");

            migrationBuilder.DropTable(
                name: "Leads");

            migrationBuilder.DropTable(
                name: "Branches");

            migrationBuilder.DropTable(
                name: "Products");

            migrationBuilder.DropTable(
                name: "SalesExecutives");

            migrationBuilder.DropTable(
                name: "States");
        }
    }
}
