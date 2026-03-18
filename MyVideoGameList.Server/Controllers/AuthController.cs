using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("[controller]")]
public class AuthController(
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<UserProfileDto>> Register([FromBody] RegisterDto dto)
    {
        var user = new ApplicationUser { UserName = dto.Email, Email = dto.Email };
        var result = await userManager.CreateAsync(user, dto.Password);

        if (!result.Succeeded)
            return BadRequest(new { errors = result.Errors.Select(e => e.Description) });

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(new UserProfileDto(user.Id, user.Email!, user.Theme));
    }

    [HttpPost("login")]
    public async Task<ActionResult<UserProfileDto>> Login([FromBody] LoginDto dto)
    {
        var result = await signInManager.PasswordSignInAsync(
            dto.Email, dto.Password, dto.RememberMe, lockoutOnFailure: false);

        if (!result.Succeeded)
            return Unauthorized(new { message = "Invalid email or password." });

        var user = await userManager.FindByEmailAsync(dto.Email);
        return Ok(new UserProfileDto(user!.Id, user.Email!, user.Theme));
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        await signInManager.SignOutAsync();
        return NoContent();
    }

    [HttpGet("me")]
    [Authorize]
    public async Task<ActionResult<UserProfileDto>> Me()
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();
        return Ok(new UserProfileDto(user.Id, user.Email!, user.Theme));
    }
}
