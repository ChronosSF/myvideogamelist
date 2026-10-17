using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <remarks>
/// <c>no-store</c>, like every answer about one person: the rows carry the owner's scores and tag ids,
/// and nothing between here and the browser should keep them for the next person at it (ADR 0065).
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
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
