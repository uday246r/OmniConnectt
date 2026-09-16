using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class CatalogConcurrencyAndDependentFilters : Migration
    {
        /// <inheritdoc />
        // No schema change: this records Version as a concurrency token on the three admin catalogs and the
        // soft-delete query filters on refresh tokens, invites and overrides in the model snapshot, so EF
        // does not report pending model changes at startup.
        protected override void Up(MigrationBuilder migrationBuilder)
        {

        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
