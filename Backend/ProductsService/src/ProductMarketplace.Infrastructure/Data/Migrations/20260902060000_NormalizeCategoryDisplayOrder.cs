using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using ProductMarketplace.Infrastructure.Data;

#nullable disable

namespace ProductMarketplace.Infrastructure.Data.Migrations
{
    /// <summary>
    /// Data repair. Until the ordering fix, updating a category's display order wrote the number
    /// straight through without touching its siblings, so a sibling set could end up with duplicate
    /// and gapped values (two categories both at 4, no category at 2). The service layer now keeps
    /// each sibling set contiguous on every write; this migration brings existing rows in line so the
    /// data matches that invariant from here on.
    ///
    /// Schema is unchanged, so there is no model snapshot change.
    /// </summary>
    [DbContext(typeof(AppDbContext))]
    [Migration("20260902060000_NormalizeCategoryDisplayOrder")]
    public partial class NormalizeCategoryDisplayOrder : Migration
    {
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Renumber each sibling set (grouped by parent, top-level rows grouped together) to a
            // contiguous 1..N, preserving the order admins currently see. CreatedAt then Id break ties
            // deterministically so the result is stable and repeatable.
            migrationBuilder.Sql("""
                WITH ranked AS (
                    SELECT "Id",
                           ROW_NUMBER() OVER (
                               PARTITION BY "ParentCategoryId"
                               ORDER BY "DisplayOrder", "CreatedAt", "Id"
                           ) AS position
                    FROM "Categories"
                )
                UPDATE "Categories" AS c
                SET "DisplayOrder" = ranked.position
                FROM ranked
                WHERE c."Id" = ranked."Id"
                  AND c."DisplayOrder" <> ranked.position;
                """);
        }

        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Renumbering is not reversible: the duplicate/gapped values it replaced were themselves
            // the defect, and the original numbers carry no information worth restoring.
        }
    }
}
