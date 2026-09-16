namespace ProductMarketplace.Application.Dtos;

/// <summary>
/// One status and how many records hold it, counted by the database.
/// </summary>
/// <remarks>
/// The Applications and Promotions pages showed "Pending Review", "Active Campaigns" and similar cards
/// by counting the rows of the page on screen — at most one page of ten, so the cards were wrong as soon
/// as there were more records than fit on a page. Statuses are admin-configured, so the counts are
/// returned per status value and the page groups them by the tone Setup gives each status.
/// </remarks>
public sealed record StatusCountDto(string Status, int Count);
