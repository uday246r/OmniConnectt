namespace AuthService.Application.DTOs;

/// <summary>
/// One salutation, with a stable id so that changing "Mr" to "Mr." is recognisable as the same entry
/// renamed — not "Mr" removed and "Mr." added, which would leave every user holding the old value.
/// </summary>
/// <param name="UserCount">How many user profiles currently show this salutation. Filled on read.</param>
public record SalutationEntryDto(string Id, string Value, int UserCount = 0);

/// <param name="Salutations">The values alone, in order — what the Create/Edit User dropdown offers.</param>
/// <param name="Entries">The same list with ids and usage counts — what the Manage Fields editor works with.</param>
public record SalutationCatalogDto(
    IReadOnlyList<string> Salutations, int Version, DateTimeOffset UpdatedAt,
    IReadOnlyList<SalutationEntryDto>? Entries = null);

/// <param name="Salutations">A plain list, for older callers: entries are matched by value, so nothing is renamed.</param>
/// <param name="Entries">The list with ids. An id kept with a new value is a rename, and cascades to users.</param>
/// <param name="ExpectedVersion">The version the editor loaded. A different current version means someone else
/// saved in the meantime, and this save is refused rather than silently undoing their change.</param>
public record UpdateSalutationCatalogRequest(
    IReadOnlyList<string>? Salutations,
    IReadOnlyList<SalutationEntryDto>? Entries = null,
    int? ExpectedVersion = null);
