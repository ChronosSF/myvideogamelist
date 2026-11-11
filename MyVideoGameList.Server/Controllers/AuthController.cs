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
    AccountConfirmation confirmation,
    PasswordReset reset,
    AdminAccounts admins,
    TimeProvider clock) : ControllerBase
{
    /// <summary>
    /// The same answer for every wrong combination, deliberately: telling "no such account" from
    /// "wrong password" turns sign-in into a way to ask whether an address has an account here.
    /// </summary>
    private static readonly object WrongCredentials = new { message = "Invalid email, username or password." };

    /// <summary>
    /// Makes an account and sends the link that confirms its address. It signs nobody in: an account
    /// can sign in only once its address is confirmed (ADR 0089).
    /// </summary>
    /// <remarks>
    /// An email that did not go is not a failed registration: the account is written by then, and a
    /// second attempt would only be told the name is taken. So the answer says whether it went, and
    /// the page offers to send it again.
    /// </remarks>
    [HttpPost("register")]
    [EnableRateLimiting(RateLimiting.AuthWrites)]
    public async Task<ActionResult<RegisterResultDto>> Register([FromBody] RegisterDto dto)
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

        var sent = await confirmation.SendAsync(user);
        return Ok(new RegisterResultDto(EmailSent: sent == EmailSend.Sent));
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
        var user = await FindByEmailOrNameAsync(dto.Email);

        if (user is null)
            return Unauthorized(WrongCredentials);

        // Counting failures is what makes the lockout configured in Program.cs happen at all.
        // A lockout answers exactly as a wrong password does, for the reason recorded there.
        var result = await signInManager.PasswordSignInAsync(
            user, dto.Password, dto.RememberMe, lockoutOnFailure: true);

        if (result.IsNotAllowed && !await userManager.IsEmailConfirmedAsync(user))
            return await UnconfirmedAsync(user, dto.Password);

        if (!result.Succeeded)
            return Unauthorized(WrongCredentials);

        return Ok(Profile(user));
    }

    /// <summary>
    /// An account whose address is not confirmed: told so, but only once the password is right.
    /// </summary>
    /// <remarks>
    /// Identity refuses an unconfirmed account before it looks at the password, and counts nothing. Said
    /// as it stands, that refusal would tell anybody who typed an address that it has an account waiting
    /// for confirmation, and would let them guess its password with no lockout at all. So the password
    /// is checked here, a wrong one counts towards the lockout as it would on a confirmed account, and
    /// both a wrong one and a lockout answer as any wrong combination does. Only the owner, with the
    /// password, learns that the address waits, and is sent the link again, at the account's pace.
    /// </remarks>
    private async Task<ActionResult<UserProfileDto>> UnconfirmedAsync(ApplicationUser user, string password)
    {
        if (await userManager.IsLockedOutAsync(user))
            return Unauthorized(WrongCredentials);

        if (!await userManager.CheckPasswordAsync(user, password))
        {
            await userManager.AccessFailedAsync(user);
            return Unauthorized(WrongCredentials);
        }

        await userManager.ResetAccessFailedCountAsync(user);

        // The owner is here, with the password, and has not confirmed: send the link, at the account's
        // pace. Somebody whose first email was lost, or who registered on the revision before
        // confirmation existed and was sent none, has one waiting without having to ask.
        var sent = await confirmation.SendAsync(user);
        return StatusCode(StatusCodes.Status403Forbidden, new
        {
            message = sent == EmailSend.Failed
                ? "Confirm your email address first. We could not send you a new link just now, so ask for one again in a moment."
                : "Confirm your email address first, with the link we have sent you. If it does not arrive, we can send another.",
            unconfirmed = true,
        });
    }

    /// <summary>
    /// The account an identifier names: an address first, the unique-by-configuration column, then a
    /// username. Signing in, asking for the confirmation again and asking for a reset resolve it the same
    /// way, here.
    /// </summary>
    private async Task<ApplicationUser?> FindByEmailOrNameAsync(string emailOrUserName) =>
        await userManager.FindByEmailAsync(emailOrUserName)
            ?? await userManager.FindByNameAsync(emailOrUserName);

    /// <summary>
    /// Confirms an address from the two halves of the link in its email. Signs nobody in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A <c>POST</c>, sent by the page the link opens once it has read the link's fragment, never a
    /// <c>GET</c> the link itself reaches: a state change behind a <c>GET</c> is forgeable and cacheable
    /// (ADR 0033), and a mail scanner that opens every link would confirm the address for its owner.
    /// </para>
    /// <para>
    /// It does not sign in, because the link outlives its use: a token stays valid for its whole day,
    /// so a link forwarded or left in a shared inbox would be a way into the account. Signing in still
    /// takes the password. A link pressed twice confirms twice, harmlessly.
    /// </para>
    /// <para>
    /// No such account and a wrong or expired token are the same answer. The id is the account's, which
    /// nothing public shows, but there is no reason to say which half was wrong.
    /// </para>
    /// </remarks>
    [HttpPost("confirm-email")]
    public async Task<ActionResult<AuthMessageDto>> ConfirmEmail(
        [FromBody] ConfirmEmailDto dto, CancellationToken cancellationToken)
    {
        // UserManager takes no token of its own, so the request's is checked between its steps: a reader
        // who has gone is not confirmed on their behalf.
        var user = await userManager.FindByIdAsync(dto.UserId);
        cancellationToken.ThrowIfCancellationRequested();
        var result = user is null ? null : await userManager.ConfirmEmailAsync(user, dto.Token);

        if (result?.Succeeded != true)
        {
            return BadRequest(new AuthMessageDto(
                "This link has expired or is not complete. Sign in and we will offer to send a new one."));
        }

        return NoContent();
    }

    /// <summary>
    /// Sends the confirmation again to an account that has not confirmed its address.
    /// </summary>
    /// <remarks>
    /// Always a 202, whether or not anything was sent: an account that does not exist, one already
    /// confirmed, and one sent a link within the last few minutes answer as one that was just sent
    /// another. The pace is per account, in <see cref="EmailPace"/>, which is what stops this
    /// being a way to fill somebody's inbox; the rate limit is per network address, which stops it
    /// being a way to ask about many addresses quickly. Registration already says whether an address is
    /// taken, so the time this takes to answer tells nothing that cannot be learned there.
    /// </remarks>
    [HttpPost("resend-confirmation")]
    [EnableRateLimiting(RateLimiting.AuthWrites)]
    public async Task<ActionResult<AuthMessageDto>> ResendConfirmation(
        [FromBody] ResendConfirmationDto dto, CancellationToken cancellationToken)
    {
        var user = await FindByEmailOrNameAsync(dto.Email);

        // As in ConfirmEmail: checked before the send, which ignores it once begun, so nobody who has
        // gone is sent an email.
        cancellationToken.ThrowIfCancellationRequested();

        if (user is not null && !await userManager.IsEmailConfirmedAsync(user))
            await confirmation.SendAsync(user);

        return Accepted();
    }

    /// <summary>
    /// Sends the link that sets a new password to the account an address or a username names.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Always a 202, whether or not anything was sent: no such account, and one sent a reset within the
    /// last few minutes, answer as one that was just sent a link (ADR 0033, ADR 0090). The pace is per
    /// account, in <see cref="EmailPace"/>, which keeps this from filling an inbox; the rate limit is
    /// per network address, which keeps it from asking about many accounts quickly. A send makes the
    /// answer slower, but registration already says whether an address is taken, so the time tells
    /// nothing that cannot be learned there (ADR 0089 §5).
    /// </para>
    /// <para>
    /// An unconfirmed account is sent one too. The reset confirms the address, so it is what lets in
    /// somebody who has neither confirmed nor kept the password they chose.
    /// </para>
    /// </remarks>
    [HttpPost("forgot-password")]
    [EnableRateLimiting(RateLimiting.AuthWrites)]
    public async Task<ActionResult<AuthMessageDto>> ForgotPassword(
        [FromBody] ForgotPasswordDto dto, CancellationToken cancellationToken)
    {
        var user = await FindByEmailOrNameAsync(dto.Email);

        // As in ResendConfirmation: checked before the send, which ignores it once begun.
        cancellationToken.ThrowIfCancellationRequested();

        if (user is not null)
            await reset.SendAsync(user);

        return Accepted();
    }

    /// <summary>
    /// Sets a new password from the two halves of the link in a reset email, and the password itself.
    /// Signs nobody in.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The reset confirms the address, ends any lockout and ends every session the account had, at each
    /// one's next request (see <see cref="PasswordReset.ResetAsync"/>). It does not sign in: signing in is
    /// one way, the sign-in dialog's, with its lockout, its confirmation check and its choice to be
    /// remembered, rather than a second way beside it that each of those would have to be kept in step
    /// with. The page offers the sign-in at once.
    /// </para>
    /// <para>
    /// No such account and a wrong, expired or used token are the same answer, as for a confirmation. A
    /// password the rules refuse is answered as registration answers one, and spends nothing: the link
    /// still works for another try.
    /// </para>
    /// <para>
    /// <b>Not rate-limited</b>, unlike the endpoints around it (ADR 0090 §7). The limit is there to stop
    /// guessing and to stop sends; this guesses nothing, since it needs a token nobody can guess, and sends
    /// nothing. Limited, it spent the budget somebody had just used up failing to sign in, and refused
    /// them the sign-in with their new password.
    /// </para>
    /// </remarks>
    [HttpPost("reset-password")]
    public async Task<ActionResult<ResetLinkRefusedDto>> ResetPassword(
        [FromBody] ResetPasswordDto dto, CancellationToken cancellationToken)
    {
        var user = await userManager.FindByIdAsync(dto.UserId);

        // UserManager takes no token of its own, so the request's is checked before the one write.
        cancellationToken.ThrowIfCancellationRequested();

        var result = user is null ? null : await reset.ResetAsync(user, dto.Token, dto.Password);

        if (result is null || result.Errors.Any(error => error.Code == nameof(IdentityErrorDescriber.InvalidToken)))
        {
            return BadRequest(new ResetLinkRefusedDto(
                "This link has expired or has already been used. Ask for a new one.", InvalidLink: true));
        }

        // Another write to the account landed first: nothing was saved and the link still works, so it is
        // a moment to try again, not a password to change. Identity's own sentence is written for a log.
        if (result.Errors.Any(error => error.Code == nameof(IdentityErrorDescriber.ConcurrencyFailure)))
            return Conflict(new AuthMessageDto("Your account changed at the same moment. Please try again."));

        if (!result.Succeeded)
            return BadRequest(new { errors = result.Errors.Select(e => e.Description) });

        return NoContent();
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
