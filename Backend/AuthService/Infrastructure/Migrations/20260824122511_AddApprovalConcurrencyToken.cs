using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace AuthService.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddApprovalConcurrencyToken : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /*
             * Deliberately empty — there is nothing to create.
             *
             * `xmin` is a PostgreSQL SYSTEM column present on every table automatically; it holds the
             * id of the transaction that last wrote the row, which is exactly what makes it a free
             * optimistic-concurrency token. The mapping in AuthDbContext only tells EF that the column
             * is already there and should be appended to UPDATE ... WHERE clauses.
             *
             * The scaffolder cannot know that and generated an AddColumn, which would have failed
             * against the reserved name (or, worse, shadowed the real system column). The migration is
             * kept rather than deleted so the model snapshot and the applied-migration history stay in
             * agreement — without it, every subsequent `migrations add` would try to add this column
             * again.
             */
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Empty for the same reason as Up: dropping `xmin` is not possible — and not desirable,
            // since PostgreSQL owns that column, not this schema.
        }
    }
}
