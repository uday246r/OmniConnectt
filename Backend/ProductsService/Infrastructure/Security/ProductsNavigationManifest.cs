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
        new("promotions", "Promotions", 40,
        [
            new("promotions", "Promotions", "Star", 10, "View"),
        ]),
        new("applications", "Applications", 50,
        [
            new("applications", "Applications", "FileText", 10, "View"),
        ]),
        new("setup", "Setup", 60,
        [
            new("setup", "Setup", "Settings", 10, "View"),
        ]),
        new("reviews", "Reviews", 65, []),
        new("audit", "Audit Logs", 70,
        [
            new("audit-logs", "Audit Logs", "ShieldCheck", 10, "View"),
        ]),
    ];

    public static NavModule? Find(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
}
