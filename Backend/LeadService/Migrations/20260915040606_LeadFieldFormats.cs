using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace LeadManagement.Api.Migrations
{
    /// <inheritdoc />
    public partial class LeadFieldFormats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ValidationsJson",
                table: "LeadFieldConfigs",
                type: "jsonb",
                nullable: true);

            // Existing products get the checks that used to be hard-coded in CreateLeadDto and the form,
            // as ordinary Field Settings rules an administrator can now change. Rows that already carry
            // rules are left alone, so re-running against a partly migrated database changes nothing.
            // Mirrors LeadFieldConfigService.DefaultRules for new products.
            migrationBuilder.Sql("""
                UPDATE "LeadFieldConfigs"
                SET "ValidationsJson" = '[{"type":"custom","pattern":"^[0-9]{6}-[0-9]{2}-[0-9]{4}$","value":null,"message":"Please enter IC Number in format YYMMDD-PB-XXXX (e.g. 880512-14-5678)."}]'::jsonb
                WHERE "ApiField" = 'icNumber' AND "ValidationsJson" IS NULL;

                UPDATE "LeadFieldConfigs"
                SET "ValidationsJson" = '[{"type":"mobileIN","pattern":null,"value":null,"message":"Please enter a valid phone number for the selected country."}]'::jsonb
                WHERE "ApiField" = 'phoneNumber' AND "ValidationsJson" IS NULL;

                UPDATE "LeadFieldConfigs"
                SET "ValidationsJson" = '[{"type":"emailSmart","pattern":null,"value":null,"message":"Please enter a valid email address."}]'::jsonb
                WHERE "ApiField" = 'email' AND "ValidationsJson" IS NULL;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ValidationsJson",
                table: "LeadFieldConfigs");
        }
    }
}
