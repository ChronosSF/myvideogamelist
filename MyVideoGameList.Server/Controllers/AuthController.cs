using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController(
    UserManager<ApplicationUser> userManager,
    SignInManager<ApplicationUser> signInManager,
    IUserNameClaimService claims,
    AdminAccounts admins,
    TimeProvider clock) : ControllerBase
{
    [HttpPost("register")]
    [EnableRateLimiting(RateLimiting.AuthWrites)]
    public async Task<ActionResult<UserProfileDto>> Register([FromBody] RegisterDto dto)
    {
        // The shape of the username has already been checked by [UserName]; what is left is
        // whether it is free. Identity answers that with a read before the write, which covers
        // everybody except two people claiming the same name at once — the unique index over
        // NormalizedUserName settles that pair, and the claim service turns the loser's failure
        // into the same DuplicateUserName error the read would have produced.
        var user = new ApplicationUser
        {
            UserName = dto.UserName,
            Email = dto.Email,
            ProfileVisibility = ProfileVisibility.Private
        };

        var result = await claims.RegisterAsync(user, dto.Password);

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
    /// one of the two memorised — and the form says so. The email is tried first, because it is
    /// the unique-by-configuration column.
    /// </para>
    /// </remarks>
    [HttpPost("login")]
    [EnableRateLimiting(RateLimiting.AuthWrites)]
    public async Task<ActionResult<UserProfileDto>> Login([FromBody] LoginDto dto)
    {
        var user = await userManager.FindByEmailAsync(dto.Email)
            ?? await userManager.FindByNameAsync(dto.Email);

        // The same message for "no such account" as for "wrong password", deliberately: telling
        // them apart turns this endpoint into a way to ask whether an address has an account here.
        if (user is null)
            return Unauthorized(new { message = "Invalid email, username or password." });

        // Counting failures is what makes the lockout configured in Program.cs happen at all.
        // A lockout answers exactly as a wrong password does, for the reason recorded there.
        var result = await signInManager.PasswordSignInAsync(
            user, dto.Password, dto.RememberMe, lockoutOnFailure: true);

        if (!result.Succeeded)
            return Unauthorized(new { message = "Invalid email, username or password." });

        return Ok(Profile(user));
    }

    [HttpPost("logout")]
    [Authorize]
    public async Task<IActionResult> Logout()
    {
        await signInManager.SignOutAsync();
        return NoContent();
    }

    /// <summary>
    /// Who is signed in, and the one place an account is seen (ADR 0051).
    /// </summary>
    /// <remarks>
    /// <para>
    /// The client asks this on every page it loads, so it is where <see cref="ApplicationUser.LastSeenAt"/>
    /// is kept: at most once a UTC day, and best effort. A lost race with another write to the account
    /// comes back as a failed <see cref="IdentityResult"/>, not an exception, and is left for the next
    /// page. It is the one write behind a <c>GET</c>, which ADR 0033 otherwise keeps to the methods that
    /// say so, and deliberately: forging it from another site records only that the browser it came
    /// from was signed in, which it was. It says <c>no-store</c>, like every answer about one person:
    /// nothing between here and the browser should keep one account for the next, and an answer kept
    /// anywhere would skip the day's write.
    /// </para>
    /// <para>
    /// Nobody signed in is an answer, not a refusal, so it is a 204 rather than the 401 an
    /// <c>[Authorize]</c> would give. A browser logs every 4xx a page's fetch receives as an error in
    /// the console, so a 401 here put one on every page a visitor opened, and cost each of them
    /// Lighthouse's console audit (#316). The endpoints that need a session still refuse without one.
    /// A cookie whose account no longer exists is nobody too.
    /// </para>
    /// <para>
    /// It is also what keeps <see cref="SignedInFlag"/> in step with the session (ADR 0074). Somebody signed
    /// in gets it again, to the session's present expiry, which a sliding session moves past the one it was
    /// set with; nobody with it left over — a session that expired, or was refused for a changed security
    /// stamp, without a sign-out — has it cleared, so the home page draws the right top section next time.
    /// </para>
    /// </remarks>
    [HttpGet("me")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<ActionResult<UserProfileDto>> Me()
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null)
        {
            if (SignedInFlag.IsSet(Request)) SignedInFlag.Clear(Response);
            return NoContent();
        }

        // Answered from the handler's own copy of this request's sign-in, which it keeps: no second read.
        var session = (await HttpContext.AuthenticateAsync(IdentityConstants.ApplicationScheme)).Properties;
        SignedInFlag.Set(Response, session?.IsPersistent == true ? session.ExpiresUtc : null);

        var now = clock.GetUtcNow();
        if (AccountActivity.IsNewDay(user.LastSeenAt, now))
        {
            user.LastSeenAt = now;
            await userManager.UpdateAsync(user);
        }

        return Ok(Profile(user));
    }

    /// <summary>
    /// The account id is the one the user was just resolved to, not the request's principal: on a
    /// sign-in or a registration the request itself is still anonymous.
    /// </summary>
    private UserProfileDto Profile(ApplicationUser user) =>
        UserProfileDto.For(user, admins.IsAdmin(user.Id));
}
