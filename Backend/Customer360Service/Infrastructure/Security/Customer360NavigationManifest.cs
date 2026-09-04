namespace backend.Infrastructure.Security;

/// <summary>
/// The sidebar this remote contributes: which pages exist, what they are called, what icon they
/// carry, and where they live in the host's URL space.
/// </summary>
/// <remarks>
/// See LeadNavigationManifest for the reasoning; this is its Customer 360 counterpart and follows the
/// same contract.
///
/// The one-module-many-rows case shows up here too, and more sharply: Individual and Non-Individual
/// are two sidebar rows over the single `profile` module, differing only in which customer type the
/// page opens with. Neither is a distinct permission.
///
/// `contact`, `interactions` and `products` are permission surface without a top-level row — those
/// pages are reached from inside a customer's 360 view, not from the sidebar, which is exactly what
/// the current UI does. Declaring them with an empty Nav list records that as a decision.
/// </remarks>
public static class Customer360NavigationManifest
{
    /// <param name="Key">Stable id, and the last URL segment: /apps/customer360/{Key}.</param>
    /// <param name="RequiredCapability">Null means "any capability on the module is enough to see this row".</param>
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
        new("profile", "Customer Profiles", 10,
        [
            new("individual", "Individual", "User", 10, "View"),
            new("non-individual", "Non-Individual", "Building2", 20, "View"),
        ]),
        new("audit", "Audit Logs", 20,
        [
            new("audit-logs", "Audit Logs", "ShieldCheck", 10, "View"),
        ]),
        new("fieldsettings", "Field Settings", 30,
        [
            new("field-settings", "Field Settings", "Settings", 10, "Manage"),
        ]),
        // Reached from inside a customer's 360 view rather than the sidebar.
        new("contact", "Contacts", 40, []),
        new("interactions", "Interactions", 50, []),
        new("products", "Products", 60, []),
    ];

    public static NavModule? Find(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase));
}
