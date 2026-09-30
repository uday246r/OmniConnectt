namespace ProductMarketplace.Api.Infrastructure.Security;

/// <summary>
/// The sidebar this remote contributes to the OmniConnectt host shell:
/// which pages exist, what they are called, what icon they carry, and where they live in the host URL space.
/// </summary>
public static class ProductsNavigationManifest
{
    public sealed record NavItem(
        string Key,
        string Label,
        string IconKey,
        int SortOrder,
        string? RequiredCapability = null);

    public sealed record NavModule(
        string ModuleKey,
        string DisplayName,
        int SortOrder,
        IReadOnlyList<NavItem> Nav);

    public static readonly IReadOnlyList<NavModule> Modules =
    [
        new("dashboard", "Dashboard", 10,
        [
            new("dashboard", "Dashboard", "Grid", 10, "View"),
        ]),
        new("products", "Products", 20,
        [
            new("products", "Products", "Package", 10, "View"),
        ]),
        new("categories", "Categories", 30,
        [
            new("categories", "Categories", "Layers", 10, "View"),
        ]),
        // The module key is a single word like every other module's; the page route reads better hyphenated.
        new("subcategories", "Sub-categories", 40,
        [
            new("sub-categories", "Sub-categories", "Layers", 10, "View"),
        ]),
        new("setup", "Setup", 50,
        [
            new("setup", "Setup", "Settings", 10, "View"),
        ]),
        new("audit", "Audit Logs", 60,
        [
            new("audit-logs", "Audit Logs", "ShieldCheck", 10, "View"),
        ]),
    ];

    public static NavModule? Find(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
}
