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
            new("View", "View dashboard", "See marketplace figures: products, applications, views and conversion.", "Api", 10),
        ]),
        new("products",
        [
            new("View", "View products", "Browse the product catalogue and open a product.", "Api", 10),
            new("Create", "Add products", "Add new products to the catalogue.", "Api", 20),
            new("Edit", "Edit products", "Change a product's details or status.", "Api", 30),
            new("Delete", "Delete products", "Remove products from the catalogue.", "Api", 40),
            new("Apply", "Apply for products", "Submit an application for a product and upload its documents.", "Api", 50),
            new("Export", "Download product list", "Download the product list as a spreadsheet file.", "Export", 60),
        ]),
        new("categories",
        [
            new("View", "View categories", "See product categories.", "Api", 10),
            new("Create", "Add categories", "Add new categories.", "Api", 20),
            new("Edit", "Edit categories", "Rename, reorder or change a category.", "Api", 30),
            new("Delete", "Delete categories", "Remove categories.", "Api", 40),
        ]),
        new("promotions",
        [
            new("View", "View promotions", "See promotional offers.", "Api", 10),
            new("Create", "Add promotions", "Create new promotional offers.", "Api", 20),
            new("Edit", "Edit promotions", "Change a promotion or its status.", "Api", 30),
            new("Delete", "Delete promotions", "Remove promotions.", "Api", 40),
        ]),
        new("reviews",
        [
            new("View", "View reviews", "Read customer reviews of products.", "Api", 10),
            new("Create", "Write reviews", "Leave a review on a product.", "Api", 20),
            new("Moderate", "Moderate reviews", "Publish, hide or reject customer reviews.", "Api", 30),
            new("Delete", "Delete reviews", "Remove customer reviews.", "Api", 40),
        ]),
        new("applications",
        [
            new("View", "View applications", "See customer applications and their documents.", "Api", 10),
            new("Manage", "Decide applications", "Move an application forward, approve or reject it.", "Api", 20),
        ]),
        new("setup",
        [
            new("View", "View setup", "See product types, fields, required documents, statuses and ranking settings.", "Api", 10),
            new("Manage", "Change setup", "Change product types, fields, required documents, statuses and ranking settings.", "Api", 20),
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
