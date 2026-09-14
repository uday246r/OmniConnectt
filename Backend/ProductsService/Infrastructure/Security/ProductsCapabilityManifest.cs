namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Business capabilities declared by ProductsService.
/// </summary>
public static class ProductsCapabilityManifest
{
    public sealed record Capability(
        string Key,
        string DisplayName,
        string Description,
        string Type,
        int SortOrder);

    public sealed record CapabilityModule(string ModuleKey, IReadOnlyList<Capability> Capabilities);

    public static readonly IReadOnlyList<CapabilityModule> Modules =
    [
        new("dashboard",
        [
            new("View", "View Dashboard", "View product & marketplace analytics metrics.", "Ui", 10),
        ]),
        new("products",
        [
            new("View", "View Products", "Browse and view marketplace products.", "Api", 10),
            new("Create", "Create Product", "Add new products to the catalog.", "Api", 20),
            new("Edit", "Edit Product", "Update existing product details.", "Api", 30),
            new("Delete", "Delete Product", "Remove products from the catalog.", "Api", 40),
            new("Apply", "Apply to Product", "Submit applications for products.", "Api", 50),
        ]),
        new("categories",
        [
            new("View", "View Categories", "View category tree and definitions.", "Api", 10),
            new("Create", "Create Category", "Add new categories.", "Api", 20),
            new("Edit", "Edit Category", "Edit category properties.", "Api", 30),
            new("Delete", "Delete Category", "Remove categories.", "Api", 40),
        ]),
        new("promotions",
        [
            new("View", "View Promotions", "View promotional campaigns.", "Api", 10),
            new("Create", "Create Promotion", "Create new promotions.", "Api", 20),
            new("Edit", "Edit Promotion", "Update promotions.", "Api", 30),
            new("Delete", "Delete Promotion", "Delete promotions.", "Api", 40),
        ]),
        new("applications",
        [
            new("View", "View Applications", "View submitted product applications.", "Api", 10),
            new("Manage", "Manage Applications", "Process and review applications.", "Api", 20),
            new("Approve", "Approve Application", "Approve product applications.", "Api", 30),
            new("Reject", "Reject Application", "Reject product applications.", "Api", 40),
        ]),
        new("setup",
        [
            new("View", "View Setup", "View product types, document definitions and field configs.", "Api", 10),
            new("Manage", "Manage Setup", "Modify status configs, document rules and field definitions.", "Api", 20),
        ]),
        new("audit",
        [
            new("View", "View Audit Logs", "View product and marketplace activity trail.", "Api", 10),
            new("Export", "Export Audit Logs", "Export audit trail to CSV.", "Export", 20),
        ]),
    ];

    public static IReadOnlyList<Capability> For(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase))
            ?.Capabilities ?? [];
}
