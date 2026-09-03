namespace backend.Infrastructure.Security;

/// <summary>
/// The business capabilities this remote owns that are not endpoints.
/// </summary>
/// <remarks>
/// See LeadCapabilityManifest for the reasoning; this is its Customer 360 counterpart and follows the
/// same contract. The list is shorter because this app has less of that kind of surface: no dashboard
/// and no charts, so what remains is the audit export and the sections of the 360 view that a
/// business might reasonably want to withhold from a role that can otherwise see a customer.
/// <para>
/// The 360 sections are worth declaring separately from the module-level View capability they sit
/// under. `contact:View`, `interactions:View` and `products:View` already gate the underlying data —
/// those stay exactly as they are, enforced at the endpoint. What is new is being able to grant
/// someone the customer view while leaving one panel off it, which no endpoint attribute can express
/// because the panel and the data are the same request.
/// </para>
/// <para>
/// That sameness is why the three panel capabilities are real boundaries: each sits on the endpoint
/// that serves the panel, so a caller without one gets a 403 rather than a hidden div.
/// <c>export.csv</c> is not, and should not be read as one — the audit CSV is assembled in the
/// browser from rows the user already holds under <c>audit:View</c>, so withholding it withholds the
/// convenience, not the data.
/// </para>
/// </remarks>
public static class Customer360CapabilityManifest
{
    /// <param name="Type">Never "Api" — see LeadCapabilityManifest.</param>
    public sealed record Capability(
        string Key,
        string DisplayName,
        string Description,
        string Type,
        int SortOrder);

    public sealed record CapabilityModule(string ModuleKey, IReadOnlyList<Capability> Capabilities);

    public static readonly IReadOnlyList<CapabilityModule> Modules =
    [
        new("profile",
        [
            new("panel.contacts", "Panel: Contacts", "Show the Contacts panel in the customer 360 view.", "Ui", 110),
            new("panel.interactions", "Panel: Interactions", "Show the Interactions panel in the customer 360 view.", "Ui", 120),
            new("panel.products", "Panel: Products", "Show the Products panel in the customer 360 view.", "Ui", 130),
        ]),

        new("audit",
        [
            new("export.csv", "Export audit log to CSV", "Download the audit trail as a CSV file.", "Export", 110),
        ]),
    ];

    public static IReadOnlyList<Capability> For(string moduleKey) =>
        Modules.FirstOrDefault(m => string.Equals(m.ModuleKey, moduleKey, StringComparison.OrdinalIgnoreCase))
            ?.Capabilities ?? [];
}
