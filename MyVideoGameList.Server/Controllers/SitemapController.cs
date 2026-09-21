using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// What the sitemap lists, as data. The XML is written by the process that serves it.
/// </summary>
/// <remarks>
/// <para>
/// This API serves <c>/api/*</c> and nothing else (ADR 0003), and a sitemap has to live at the
/// site's root, so <c>/sitemap.xml</c> is a route on the front-end server and these endpoints are
/// what it reads. Anonymous, because a crawler has no cookie and neither does the server asking
/// on its behalf.
/// </para>
/// <para>
/// <b><c>no-store</c> on all three, so there is one cache and not two.</b> The XML in front of
/// these states its own policy and is what the CDN holds. A second TTL here would add to it, and
/// the profile names are the case that matters: a profile switched back to private should leave
/// the sitemap when that file's window closes, not a window and a half later.
/// </para>
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class SitemapController(ISitemapService sitemap) : ControllerBase
{
    /// <summary>
    /// How many games and profiles there are to list, and how many of them fit in one file.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<SitemapSummaryDto>> GetSummary(CancellationToken cancellationToken)
    {
        return Ok(await sitemap.GetSummaryAsync(cancellationToken));
    }

    /// <summary>
    /// One file's worth of game ids. A page past the end is an empty list.
    /// </summary>
    [HttpGet("games")]
    public async Task<ActionResult<IReadOnlyList<int>>> GetGames(
        CancellationToken cancellationToken,
        [FromQuery][Range(1, int.MaxValue)] int page = 1)
    {
        return Ok(await sitemap.GetGameIdsAsync(page, cancellationToken));
    }

    /// <summary>
    /// One file's worth of usernames, each with a public profile that has something on it.
    /// </summary>
    /// <remarks>
    /// Every name here is one its owner published, so this discloses nothing <c>/u/{name}</c> does
    /// not. What it must never do is list a private one — see <c>SitemapService</c>.
    /// </remarks>
    [HttpGet("profiles")]
    public async Task<ActionResult<IReadOnlyList<string>>> GetProfiles(
        CancellationToken cancellationToken,
        [FromQuery][Range(1, int.MaxValue)] int page = 1)
    {
        return Ok(await sitemap.GetProfileNamesAsync(page, cancellationToken));
    }
}
