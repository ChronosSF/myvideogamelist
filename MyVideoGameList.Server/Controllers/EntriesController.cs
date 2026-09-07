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
    IPlaythroughService playthroughService,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    /// <summary>
    /// Everything the user has recorded about one game — the entry, its playthroughs and their
    /// review — in one round trip, because the panel that shows them shows them together.
    /// </summary>
    [HttpGet("{gameId:int}")]
    public async Task<ActionResult<EntryDetailDto>> GetEntry(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var entry = await listService.GetEntryAsync(user.Id, gameId, cancellationToken);
        if (entry is null) return NotFound();

        var playthroughs = await playthroughService.GetForGameAsync(user.Id, gameId, cancellationToken);

        // Review stays null until the review table ships; the field is here from the start so the
        // client's type does not churn when it does.
        return Ok(new EntryDetailDto(entry, playthroughs, Review: null));
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

    [HttpGet("{gameId:int}/playthroughs")]
    public async Task<ActionResult<IReadOnlyList<PlaythroughDto>>> GetPlaythroughs(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return Ok(await playthroughService.GetForGameAsync(user.Id, gameId, cancellationToken));
    }

    /// <summary>
    /// Records one more time through the game, creating the entry if there is none.
    /// </summary>
    /// <remarks>
    /// No guard on the body here: <see cref="PlaythroughInputDto"/> validates the type key and the
    /// date order by attribute and by <c>IValidatableObject</c>, so <c>[ApiController]</c> has
    /// already returned the 400 for anything malformed.
    /// </remarks>
    [HttpPost("{gameId:int}/playthroughs")]
    public async Task<ActionResult<PlaythroughDto>> AddPlaythrough(
        [Range(1, int.MaxValue)] int gameId,
        [FromBody] PlaythroughInputDto dto,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var created = await playthroughService.AddAsync(user.Id, gameId, dto, cancellationToken);
        return CreatedAtAction(nameof(GetPlaythroughs), new { gameId }, created);
    }

    [HttpPut("{gameId:int}/playthroughs/{playthroughId:int}")]
    public async Task<ActionResult<PlaythroughDto>> UpdatePlaythrough(
        [Range(1, int.MaxValue)] int gameId,
        [Range(1, int.MaxValue)] int playthroughId,
        [FromBody] PlaythroughInputDto dto,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var updated = await playthroughService.UpdateAsync(
            user.Id, gameId, playthroughId, dto, cancellationToken);

        // Another account's playthrough is simply not found, so this says nothing about whether
        // the id exists.
        return updated is null ? NotFound() : Ok(updated);
    }

    [HttpDelete("{gameId:int}/playthroughs/{playthroughId:int}")]
    public async Task<IActionResult> DeletePlaythrough(
        [Range(1, int.MaxValue)] int gameId,
        [Range(1, int.MaxValue)] int playthroughId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var deleted = await playthroughService.DeleteAsync(
            user.Id, gameId, playthroughId, cancellationToken);

        return deleted ? NoContent() : NotFound();
    }

    /// <summary>
    /// Deletes every trace of this game from the user's account. The status history in
    /// <c>UserGameEvents</c> is deliberately kept — it records what the user did, not what they
    /// currently hold. The playthroughs and the review go with the entry, because those describe
    /// what is being deleted rather than what happened to it.
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
