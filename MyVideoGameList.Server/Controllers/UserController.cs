using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("[controller]")]
[Authorize]
public class UserController(UserManager<ApplicationUser> userManager) : ControllerBase
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
}
