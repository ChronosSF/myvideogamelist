using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GamesController(IIgdbService igdbService) : ControllerBase
{
    private const int PageSize = 20;

    [HttpGet]
    public async Task<ActionResult<PagedGamesResponse>> GetGames(
        [FromQuery] int offset = 0,
        [FromQuery] string? search = null)
    {
        if (offset < 0)
            return BadRequest("Offset must be non-negative.");

        var result = await igdbService.GetGamesAsync(offset, PageSize, search);
        return Ok(result);
    }

    [HttpGet("upcoming")]
    public async Task<ActionResult<IEnumerable<GameDto>>> GetUpcomingReleases()
    {
        var result = await igdbService.GetUpcomingReleasesAsync();
        return Ok(result);
    }
}
