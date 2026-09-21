using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// What this site asks a search engine to index, read from our own tables.
/// </summary>
/// <remarks>
/// Makes no IGDB call, for the reason the statistics and the export do not: a sitemap that fails
/// when a third party does tells a crawler the site has no pages. See
/// <c>docs/decisions/0036-what-a-crawler-is-told.md</c>.
/// </remarks>
public interface ISitemapService
{
    Task<SitemapSummaryDto> GetSummaryAsync(CancellationToken cancellationToken = default);

    /// <param name="page">1-based. A page past the end is an empty list, not an error.</param>
    Task<IReadOnlyList<int>> GetGameIdsAsync(int page, CancellationToken cancellationToken = default);

    /// <param name="page">1-based. A page past the end is an empty list, not an error.</param>
    Task<IReadOnlyList<string>> GetProfileNamesAsync(
        int page, CancellationToken cancellationToken = default);
}
