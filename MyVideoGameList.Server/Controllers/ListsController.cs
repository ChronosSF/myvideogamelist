using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class ListsController(
    IListService listService,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ListsDto>> GetLists(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var lists = await listService.GetListsAsync(user.Id, cancellationToken);
        return Ok(lists);
    }

    [HttpPut("{gameId:int}")]
    public async Task<IActionResult> SetListEntry(
        [Range(1, int.MaxValue)] int gameId,
        [FromBody] SetListEntryDto dto,
        CancellationToken cancellationToken)
    {
        // No guard here: SetListEntryDto validates the status by attribute, so [ApiController]
        // has already returned a 400 for anything unrecognised.
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        await listService.SetListEntryAsync(user.Id, gameId, dto.Status, cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// Puts some of a list's games where the user has arranged them by hand — the backlog's "what I
    /// will play next".
    /// </summary>
    /// <remarks>
    /// <para>
    /// A <c>PATCH</c>, as the import's row decisions are: it writes the games it names and leaves every
    /// other game in the list where it was, which is what keeps a move to one row (ADR 0054). The
    /// numbers are the client's; the server checks their range and that each game is in this list.
    /// </para>
    /// <para>
    /// Any of the five lists, though the client offers the order on the backlog alone. Like a sort
    /// preference, a position means nothing to the server, and a list that is later given an order of
    /// its own should need no change here.
    /// </para>
    /// </remarks>
    [HttpPatch("{status}/positions")]
    [RequestSizeLimit(HandOrder.MaxRequestBytes)]
    public async Task<IActionResult> SetPositions(
        [AllowedValues(
            ListStatusKeys.Backlog,
            ListStatusKeys.Playing,
            ListStatusKeys.OnHold,
            ListStatusKeys.Finished,
            ListStatusKeys.Dropped)]
        string status,
        [FromBody] SetPositionsDto dto,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        await listService.SetPositionsAsync(user.Id, status, dto.Positions, cancellationToken);
        return NoContent();
    }

    [HttpDelete("{gameId:int}")]
    public async Task<IActionResult> RemoveListEntry(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var removed = await listService.RemoveListEntryAsync(user.Id, gameId, cancellationToken);
        return removed ? NoContent() : NotFound();
    }
}
