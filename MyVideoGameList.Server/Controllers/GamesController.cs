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

    /// <summary>
    /// A page of the browse listing, or of a search, with optional filters and an order.
    /// </summary>
    /// <remarks>
    /// Every filter is a bounded integer checked by attribute, which is what lets the query builder
    /// interpolate them without escaping. An unknown order is a 400 rather than a quiet fall back to
    /// the default, so a mistyped link says so. See ADR 0032.
    /// </remarks>
    [HttpGet]
    public async Task<ActionResult<PagedGamesResponse>> GetGames(
        CancellationToken cancellationToken,
        [FromQuery][Range(0, int.MaxValue)] int offset = 0,
        [FromQuery] string? search = null,
        [FromQuery][AllowedValues(
            null,
            GameSortKeys.Rating,
            GameSortKeys.Popular,
            GameSortKeys.Newest,
            GameSortKeys.Name)] string? sort = null,
        [FromQuery][Range(1, int.MaxValue)] int? platform = null,
        [FromQuery][Range(1, int.MaxValue)] int? genre = null,
        // First releases before 1950 are not what anybody browses by year for, and the range keeps
        // the year arithmetic in the query builder well inside DateTimeOffset.
        [FromQuery][Range(1950, 2100)] int? year = null,
        [FromQuery][Range(1, 100)] int? minScore = null)
    {
        var browse = new GameBrowseQuery(sort ?? GameSortKeys.Rating, platform, genre, year, minScore);
        var result = await igdbService.GetGamesAsync(offset, PageSize, search, browse, cancellationToken);
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
    /// Paged by cursor: each page ends with the <c>after</c> for the next, encrypted, because it
    /// carries a review id the client must not see. The attribute refuses anything not shaped like
    /// a token before a decryption is spent on it; one that is shaped right but does not decrypt —
    /// tampered with, or issued under a key ring this instance does not hold — is the same 400,
    /// from the service.
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
        try
        {
            return Ok(await communityService.GetReviewsAsync(id, after, cancellationToken));
        }
        catch (ArgumentException)
        {
            // The one rule an attribute cannot express, since it takes the key ring to check. Put
            // in the shape ValidationProblemDetails gives every other 400, beside the parameter.
            ModelState.AddModelError(nameof(after), "That is not a page of this list. Start again from the first.");
            return ValidationProblem(ModelState);
        }
    }

    [HttpGet("upcoming")]
    public async Task<ActionResult<IEnumerable<GameDto>>> GetUpcomingReleases(
        CancellationToken cancellationToken)
    {
        var result = await igdbService.GetUpcomingReleasesAsync(cancellationToken);
        return Ok(result);
    }
}
