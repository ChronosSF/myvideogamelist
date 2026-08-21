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
        if (!ListService.IsValidListType(dto.ListType))
            return BadRequest(new { message = "ListType must be 'playing', 'backlog', or 'finished'." });

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        await listService.SetListEntryAsync(user.Id, gameId, dto.ListType, cancellationToken);
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
