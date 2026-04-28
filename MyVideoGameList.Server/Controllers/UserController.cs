using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UserController(
    UserManager<ApplicationUser> userManager,
    ApplicationDbContext db) : ControllerBase
{
    [HttpPut("theme")]
    public async Task<IActionResult> UpdateTheme([FromBody] UpdateThemeDto dto)
    {
        if (dto.Theme != "light" && dto.Theme != "dark")
            return BadRequest(new { message = "Theme must be 'light' or 'dark'." });

        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        user.Theme = dto.Theme;
        await userManager.UpdateAsync(user);
        return NoContent();
    }

    [HttpGet("hidden-platforms")]
    public async Task<ActionResult<IEnumerable<int>>> GetHiddenPlatforms()
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        var ids = await db.UserHiddenPlatforms
            .Where(hp => hp.UserId == user.Id)
            .Select(hp => hp.IgdbPlatformId)
            .ToListAsync();

        return Ok(ids);
    }

    [HttpPut("hidden-platforms")]
    public async Task<IActionResult> UpdateHiddenPlatforms([FromBody] UpdateHiddenPlatformsDto dto)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        var existing = await db.UserHiddenPlatforms
            .Where(hp => hp.UserId == user.Id)
            .ToListAsync();

        db.UserHiddenPlatforms.RemoveRange(existing);

        var newEntries = dto.PlatformIds
            .Distinct()
            .Select(id => new UserHiddenPlatform { UserId = user.Id, IgdbPlatformId = id });

        await db.UserHiddenPlatforms.AddRangeAsync(newEntries);
        await db.SaveChangesAsync();

        return NoContent();
    }
}
