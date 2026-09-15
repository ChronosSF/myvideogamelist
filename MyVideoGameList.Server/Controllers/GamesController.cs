using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GamesController(
    IIgdbService igdbService,
    IPlaythroughService playthroughService,
    IGameCommunityService communityService) : ControllerBase
{
    private const int PageSize = 20;

    [HttpGet("{id:int}")]
    public async Task<ActionResult<GameDto>> GetGame(
        [Range(1, int.MaxValue)] int id,
        CancellationToken cancellationToken)
    {
        var result = await igdbService.GetGameByIdAsync(id, cancellationToken);
        if (result is null)
            return NotFound();

        return Ok(result);
    }

    [HttpGet]
    public async Task<ActionResult<PagedGamesResponse>> GetGames(
        CancellationToken cancellationToken,
        [FromQuery][Range(0, int.MaxValue)] int offset = 0,
        [FromQuery] string? search = null)
    {
        var result = await igdbService.GetGamesAsync(offset, PageSize, search, cancellationToken);
        return Ok(result);
    }

    /// <summary>
    /// How long MVGL members report this game taking, in the same three tiers IGDB reports, with
    /// the number of playthroughs behind each.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Deliberately public and unauthenticated: it is an aggregate over everybody, it names
    /// nobody, and the game page shows it to signed-out visitors alongside IGDB's own figures.
    /// </para>
    /// <para>
    /// Always 200. A game nobody has logged returns three buckets of zero samples, which is an
    /// answer — a 404 would be indistinguishable from the game not existing.
    /// </para>
    /// </remarks>
    [HttpGet("{id:int}/community-times")]
    public async Task<ActionResult<CommunityTimesDto>> GetCommunityTimes(
        [Range(1, int.MaxValue)] int id,
        CancellationToken cancellationToken)
    {
        return Ok(await playthroughService.GetCommunityTimesAsync(id, cancellationToken));
    }

    /// <summary>
    /// Every member's score for this game — how many, their mean, and how they spread over the
    /// scale.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Public and unauthenticated for the reason the community times are: an aggregate over
    /// everybody that names nobody. Always 200; a game nobody has scored is ten empty buckets.
    /// </para>
    /// <para>
    /// <c>no-store</c>, so that nothing between here and the browser serves somebody an old figure
    /// after they have just scored the game — the reason the service keeps no cache of it either.
    /// </para>
    /// </remarks>
    [HttpGet("{id:int}/community-scores")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<CommunityScoresDto>> GetCommunityScores(
        [Range(1, int.MaxValue)] int id,
        CancellationToken cancellationToken)
    {
        return Ok(await communityService.GetScoresAsync(id, cancellationToken));
    }

    /// <summary>
    /// A page of the reviews members have published about this game, newest first.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Public, and identical for every reader — including a review's own author, who sees theirs
    /// here only if it is published. Only a review marked public, on a public profile, is listed.
    /// </para>
    /// <para>
    /// Paged by cursor: each page ends with the <c>after</c> for the next. The attribute is the
    /// whole of its validation — a malformed cursor is a 400, and every cursor that passes is one
    /// the service can read.
    /// </para>
    /// <para>
    /// <c>no-store</c>, and this is the one that matters. These responses carry text their authors
    /// can withdraw, and a withdrawal has to take effect when it is made — so neither this server
    /// nor a CDN in front of it may keep a copy. This is fetched by the browser through whatever
    /// fronts <c>/api</c>, and nothing has configured that yet (ROADMAP D12), so the response says
    /// it for itself rather than relying on a cache behaviour to be set up correctly later.
    /// </para>
    /// </remarks>
    [HttpGet("{id:int}/reviews")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<GameReviewsDto>> GetReviews(
        [Range(1, int.MaxValue)] int id,
        CancellationToken cancellationToken,
        // Absent for the first page; otherwise the `next` the previous page returned.
        [FromQuery][RegularExpression(ReviewCursor.Pattern)] string? after = null)
    {
        return Ok(await communityService.GetReviewsAsync(id, after, cancellationToken));
    }

    [HttpGet("upcoming")]
    public async Task<ActionResult<IEnumerable<GameDto>>> GetUpcomingReleases(
        CancellationToken cancellationToken)
    {
        var result = await igdbService.GetUpcomingReleasesAsync(cancellationToken);
        return Ok(result);
    }
}
