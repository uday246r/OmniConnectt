namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// Human wording for the capabilities this service publishes, plus the ones no endpoint guards by itself.
/// </summary>
/// <remarks>
/// <para>
/// Which API capabilities exist is NOT decided here. <c>GET /permissions</c> reflects over the
/// <see cref="RequiresCapabilityAttribute"/>s actually on the controllers, so the Role editor can only
/// offer permissions something enforces. This file used to be that list, typed by hand and enforced
/// nowhere — every checkbox granted nothing and removing one refused nothing.
/// </para>
/// <para>
/// Entries of type "Api" here only supply a label and description for a capability reflection found;
/// an "Api" entry reflection did not find is not published. Other types — "Export", "Widget", "Chart" —
/// are published from here, because they are enforced by <see cref="RequiresFineCapabilityAttribute"/>
/// or the UI rather than by the token.
/// </para>
/// </remarks>
public static class ProductsCapabilityManifest
{
    public sealed record Capability(string Key, string DisplayName, string Description, string Type, int SortOrder);

    public sealed record CapabilityModule(string ModuleKey, IReadOnlyList<Capability> Capabilities);

    public static readonly IReadOnlyList<CapabilityModule> Modules =
    [
        new("dashboard",
        [
            new("View", "View dashboard", "See catalogue figures: products, categories, sub-categories and recent activity.", "Api", 10),
        ]),
        new("products",
        [
            new("View", "View products", "Browse the product catalogue and open a product.", "Api", 10),
            new("Create", "Add products", "Add new products to the catalogue.", "Api", 20),
            new("Edit", "Edit products", "Change a product's details or status.", "Api", 30),
            new("Delete", "Delete products", "Remove products from the catalogue.", "Api", 40),
            new("Export", "Download product list", "Download the product list as a spreadsheet file.", "Export", 50),
        ]),
        new("categories",
        [
            new("View", "View categories", "See product categories.", "Api", 10),
            new("Create", "Add categories", "Add new categories.", "Api", 20),
            new("Edit", "Edit categories", "Rename, reorder or change a category, including making it inactive to hide everything beneath it.", "Api", 30),
            new("Delete", "Delete categories", "Remove categories that have no sub-categories.", "Api", 40),
        ]),
        new("subcategories",
        [
            new("View", "View sub-categories", "See the sub-categories within each category.", "Api", 10),
            new("Create", "Add sub-categories", "Add new sub-categories.", "Api", 20),
            new("Edit", "Edit sub-categories", "Rename, reorder, move or change a sub-category.", "Api", 30),
            new("Delete", "Delete sub-categories", "Remove sub-categories that have no products.", "Api", 40),
        ]),
        new("setup",
        [
            new("View", "View setup", "See product fields, required documents and statuses.", "Api", 10),
            new("Manage", "Change setup", "Change product fields, required documents and statuses.", "Api", 20),
        ]),
        new("audit",
        [
            new("View", "View audit log", "See who did what in Products & Marketplace.", "Api", 10),
            new("Export", "Download audit log", "Download the audit log as a spreadsheet file.", "Export", 20),
        ]),
    ];

    public static IReadOnlyList<Capability> For(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase))
            ?.Capabilities ?? [];
}
