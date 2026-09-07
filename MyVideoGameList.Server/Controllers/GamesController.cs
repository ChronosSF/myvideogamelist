using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GamesController(
    IIgdbService igdbService,
    IPlaythroughService playthroughService) : ControllerBase
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

    [HttpGet("upcoming")]
    public async Task<ActionResult<IEnumerable<GameDto>>> GetUpcomingReleases(
        CancellationToken cancellationToken)
    {
        var result = await igdbService.GetUpcomingReleasesAsync(cancellationToken);
        return Ok(result);
    }
}
