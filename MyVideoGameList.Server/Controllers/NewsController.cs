using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class NewsController(ISteamNewsService steamNewsService) : ControllerBase
{
    private const int GameNewsCount = 5;

    /// <summary>
    /// News and patch notes for one game.
    /// </summary>
    /// <remarks>
    /// Answers 200 with an empty list, never 404, when the game has no Steam presence. The
    /// caller cannot distinguish "no news yet" from "not on Steam", and should not try to: both
    /// mean the same thing to the panel, which hides itself either way.
    /// </remarks>
    [HttpGet("game/{gameId:int}")]
    public async Task<ActionResult<IEnumerable<NewsItemDto>>> GetGameNews(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var result = await steamNewsService.GetNewsForGameAsync(gameId, GameNewsCount, cancellationToken);
        return Ok(result);
    }
}
