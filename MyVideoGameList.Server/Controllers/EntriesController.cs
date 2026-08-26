using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// What a user has recorded about a single game: their score today, and their playthroughs, notes
/// and review in time.
/// </summary>
/// <remarks>
/// Separate from <see cref="ListsController"/> because none of this is list-shaped. A score is a
/// judgement about a game and survives the game leaving every list, so routing "clear my score"
/// through a controller called <c>lists</c> would misdescribe what is happening. The lists
/// endpoint is a view over these same entries.
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class EntriesController(
    IListService listService,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet("{gameId:int}")]
    public async Task<ActionResult<ListEntryDto>> GetEntry(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var entry = await listService.GetEntryAsync(user.Id, gameId, cancellationToken);
        return entry is null ? NotFound() : Ok(entry);
    }

    [HttpPut("{gameId:int}/score")]
    public async Task<IActionResult> SetScore(
        [Range(1, int.MaxValue)] int gameId,
        [FromBody] SetScoreDto dto,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        await listService.SetScoreAsync(user.Id, gameId, dto.Score, cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Deletes every trace of this game from the user's account. The status history in
    /// <c>UserGameEvents</c> is deliberately kept — it records what the user did, not what they
    /// currently hold.
    /// </summary>
    [HttpDelete("{gameId:int}")]
    public async Task<IActionResult> DeleteEntry(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var deleted = await listService.DeleteEntryAsync(user.Id, gameId, cancellationToken);
        return deleted ? NoContent() : NotFound();
    }
}
