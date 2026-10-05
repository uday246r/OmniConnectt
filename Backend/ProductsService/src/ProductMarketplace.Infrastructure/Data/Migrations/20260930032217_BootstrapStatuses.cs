using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ProductMarketplace.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class BootstrapStatuses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // The only data the system cannot work without: the statuses every product, sub-category and
            // category write is validated against, and which of them make a record live in the catalogue.
            // Nothing else is seeded — no categories, no products — so the catalogue starts empty and is
            // built through the app. Ids are fixed (derived, not random) so this is reproducible.
            //
            // The lowest SortOrder per entity type is the status a new record starts with. Products start
            // as Draft on purpose: nothing should go live without someone choosing it.
            migrationBuilder.InsertData(
                table: "StatusConfigs",
                columns: new[] { "Id", "EntityType", "Value", "Label", "Color", "Enabled", "IsLive", "SortOrder" },
                values: new object[,]
                {
                    { new Guid("b0a34807-9272-552a-875b-60065d2662c1"), "Product", "Draft", "Draft", "warning", true, false, 1 },
                    { new Guid("c669503e-6c12-52e5-b61c-61864d19b1fc"), "Product", "Active", "Active", "success", true, true, 2 },
                    { new Guid("c262dced-d10f-587f-b26f-0f09da5207c0"), "Product", "Inactive", "Inactive", "danger", true, false, 3 },
                    { new Guid("d24f327c-e3d6-57f6-bc94-ad181bd9ddb4"), "SubCategory", "Active", "Active", "success", true, true, 1 },
                    { new Guid("9b6aa447-eae1-5cbd-b78a-cd16f692b4ef"), "SubCategory", "Inactive", "Inactive", "danger", true, false, 2 },
                    { new Guid("56ce8f48-7ca6-538a-8358-664c06a3ac45"), "Category", "Active", "Active", "success", true, true, 1 },
                    { new Guid("9396d525-491e-56cd-be5c-141b22eaf438"), "Category", "Draft", "Draft", "warning", true, false, 2 },
                    { new Guid("41dd9b31-9be9-54fc-ac22-108333d74cb3"), "Category", "Inactive", "Inactive", "danger", true, false, 3 }
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DELETE FROM \"StatusConfigs\" WHERE \"EntityType\" IN ('Product', 'SubCategory', 'Category');");
        }
    }
}
