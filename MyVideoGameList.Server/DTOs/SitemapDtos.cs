namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// How much the sitemap has to list, so the index in front of it knows how many files to name.
/// </summary>
/// <remarks>
/// <see cref="PageSize"/> travels with the counts rather than being a constant the front end keeps
/// in step: the number of files is <c>ceil(count / pageSize)</c>, and that sum is only right when
/// both halves come from the same place.
/// </remarks>
public record SitemapSummaryDto(int Games, int Profiles, int PageSize);

/// <summary>
/// One public profile the sitemap lists: the two halves of its address, <c>/u/{publicId}/{userName}</c>
/// (ADR 0096).
/// </summary>
/// <param name="UserName">
/// As its owner capitalised it, which is what the profile page builds its canonical address from, so
/// the sitemap and the page write the same string.
/// </param>
public record SitemapProfileDto(string PublicId, string UserName);
