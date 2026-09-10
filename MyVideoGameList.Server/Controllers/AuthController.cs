using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager) : ControllerBase
{
    [HttpPost("register")]
    public async Task<ActionResult<UserProfileDto>> Register([FromBody] RegisterDto dto)
    {
        // The shape of the username has already been checked by [UserName]; what is left is
        // whether it is free, which only the unique index over NormalizedUserName can answer and
        // only at the moment of writing. CreateAsync returns that as a DuplicateUserName error.
        var user = new ApplicationUser
        {
            UserName = dto.UserName,
            Email = dto.Email,
            ProfileVisibility = ProfileVisibility.Private
        };

        var result = await userManager.CreateAsync(user, dto.Password);

        if (!result.Succeeded)
            return BadRequest(new { errors = result.Errors.Select(e => e.Description) });

        await signInManager.SignInAsync(user, isPersistent: true);
        return Ok(Profile(user));
    }

    /// <summary>
    /// Signs in with an email address or a username, and a password.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The lookup is explicit rather than left to
    /// <see cref="SignInManager{TUser}.PasswordSignInAsync(string, string, bool, bool)"/>, which
    /// resolves its first argument as a <em>username</em>. That happened to work while registration
    /// set the username to the email address, and it stopped working the day the username became a
    /// handle — which is the kind of breakage that looks like "the password is wrong" to everybody
    /// it happens to.
    /// </para>
    /// <para>
    /// Both are accepted because the field is one box on a form and the person filling it in has
    /// one of the two memorised. The email is tried first: it is what the label says, and it is the
    /// unique-by-configuration column.
    /// </para>
    /// </remarks>
    [HttpPost("login")]
    public async Task<ActionResult<UserProfileDto>> Login([FromBody] LoginDto dto)
    {
        var user = await userManager.FindByEmailAsync(dto.Email)
            ?? await userManager.FindByNameAsync(dto.Email);

        // The same message for "no such account" as for "wrong password", deliberately: telling
        // them apart turns this endpoint into a way to ask whether an address has an account here.
        if (user is null)
            return Unauthorized(new { message = "Invalid email or password." });

        var result = await signInManager.PasswordSignInAsync(
            user, dto.Password, dto.RememberMe, lockoutOnFailure: false);

        if (!result.Succeeded)
            return Unauthorized(new { message = "Invalid email or password." });

        return Ok(Profile(user));
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
        return Ok(Profile(user));
    }

    /// <summary>
    /// One shape for the signed-in user, so the three endpoints that return it cannot disagree
    /// about what it contains.
    /// </summary>
    private static UserProfileDto Profile(ApplicationUser user) =>
        new(user.Id, user.Email!, user.UserName!, user.Theme, user.ProfileVisibility);
}
