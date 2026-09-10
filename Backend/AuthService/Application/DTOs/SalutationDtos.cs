namespace AuthService.Application.DTOs;

public record SalutationCatalogDto(IReadOnlyList<string> Salutations, int Version, DateTimeOffset UpdatedAt);

public record UpdateSalutationCatalogRequest(IReadOnlyList<string> Salutations);
