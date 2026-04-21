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
    public async Task<ActionResult<ListsDto>> GetLists()
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var lists = await listService.GetListsAsync(user.Id);
        return Ok(lists);
    }

    [HttpPut("{gameId:int}")]
    public async Task<IActionResult> SetListEntry(int gameId, [FromBody] SetListEntryDto dto)
    {
        if (gameId <= 0)
            return BadRequest(new { message = "gameId must be a positive integer." });

        if (!ListService.IsValidListType(dto.ListType))
            return BadRequest(new { message = "ListType must be 'playing', 'backlog', or 'finished'." });

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        await listService.SetListEntryAsync(user.Id, gameId, dto.ListType);
        return NoContent();
    }

    [HttpDelete("{gameId:int}")]
    public async Task<IActionResult> RemoveListEntry(int gameId)
    {
        if (gameId <= 0)
            return BadRequest(new { message = "gameId must be a positive integer." });

        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var removed = await listService.RemoveListEntryAsync(user.Id, gameId);
        return removed ? NoContent() : NotFound();
    }
}
