using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GamesController(IIgdbService igdbService) : ControllerBase
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

    [HttpGet("upcoming")]
    public async Task<ActionResult<IEnumerable<GameDto>>> GetUpcomingReleases(
        CancellationToken cancellationToken)
    {
        var result = await igdbService.GetUpcomingReleasesAsync(cancellationToken);
        return Ok(result);
    }
}
