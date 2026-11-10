using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// Ends every session of a deleted account on the next request it makes, rather than at Identity's next
/// security-stamp check, up to thirty minutes later (ADR 0077); and every session an account had when its
/// password was reset, the same way (ADR 0090).
/// </summary>
/// <remarks>
/// <para>
/// Deleting an account signs out the browser that deleted it, and nothing else. A cookie for the same
/// account held anywhere else is still a valid ticket — signed with the key ring, inside its thirty days
/// — and Identity only asks whether its account is still there when it next checks the security stamp,
/// every thirty minutes. Until then every endpoint that reads only the cookie's id claim answered as if
/// the account existed: the statistics as a library of zeros, a write as a 500 against a foreign key to a
/// missing row, the export by throwing (issue 295).
/// </para>
/// <para>
/// So every request a session cookie authenticates asks one thing more, by primary key: is the account
/// there. That is cheaper than making Identity's own check run on every request, which loads the account,
/// its roles and its claims to rebuild the principal and reissues the cookie on every response; and it is
/// one place rather than a lookup in each endpoint, which the next endpoint would forget. A changed stamp
/// — a rename rotates it — is still Identity's, on its own clock: this is about the account having gone,
/// which no stamp can say.
/// </para>
/// <para>
/// <b>And whether the account has ended its sessions since this one began</b>, from the same row: a
/// password reset does, through <see cref="ApplicationUser.SessionsEndedAt"/>, because somebody resetting a
/// password may be doing it because somebody else has it, and half an hour is long enough to do harm. A
/// session is over when it began at or before that moment and carries a stamp the account no longer has.
/// Both halves are needed: a session's start is kept to the second, so the moment alone would end one
/// signed in just after the reset, within the same second; and the stamp alone would end a renamed
/// account's other sessions at once, which ADR 0077 §4 leaves to Identity's clock. Every session from
/// before the reset carries the stamp the reset replaced, and every one since was issued after it.
/// </para>
/// <para>
/// A refused session is signed out as Identity's own refusal signs one out, the two-factor remembrance
/// included, so the browser loses the cookie and the signed-in flag with it (<see cref="SignedInFlag"/>),
/// and the request carries on as a visitor's: a 401 wherever a session is needed, nobody from
/// <c>/api/auth/me</c>.
/// </para>
/// <para>
/// Identity's check is the one thing this leans on, so <c>AuthFlowTests</c> shows it still runs after
/// the wrap: an aged session for an account whose stamp has changed is refused, by it alone.
/// </para>
/// </remarks>
public static class DeletedAccountSessions
{
    /// <summary>Checks the account after Identity's own check, on every request a session cookie authenticates.</summary>
    public static void EndAtOnce(CookieAuthenticationEvents events)
    {
        // Identity's security-stamp validator, which AddIdentity put here before this runs. Kept, and run
        // first: a session it refuses needs nothing more asked of it, and one it renews has just had its
        // account read, and found.
        var validateStamp = events.OnValidatePrincipal;

        events.OnValidatePrincipal = async context =>
        {
            await validateStamp(context);
            if (context.Principal is not { } principal || context.ShouldRenew) return;

            var services = context.HttpContext.RequestServices;
            var userId = services.GetRequiredService<UserManager<ApplicationUser>>().GetUserId(principal);
            if (userId is null) return;

            var db = services.GetRequiredService<ApplicationDbContext>();
            var account = await db.Users
                .Where(user => user.Id == userId)
                .Select(user => new { user.SecurityStamp, user.SessionsEndedAt })
                .SingleOrDefaultAsync(context.HttpContext.RequestAborted);

            var stampClaim = services.GetRequiredService<IOptions<IdentityOptions>>().Value.ClaimsIdentity.SecurityStampClaimType;
            if (account is not null && !Ended(
                    account.SessionsEndedAt,
                    account.SecurityStamp,
                    principal.FindFirst(stampClaim)?.Value,
                    context.Properties.IssuedUtc))
            {
                return;
            }

            // Identity's own refusal, call for call (SecurityStampValidator.ValidateAsync). The two-factor
            // remembrance is a cookie nothing sets yet, and the account's must not outlive it once one does.
            context.RejectPrincipal();
            await services.GetRequiredService<SignInManager<ApplicationUser>>().SignOutAsync();
            await context.HttpContext.SignOutAsync(IdentityConstants.TwoFactorRememberMeScheme);
        };
    }

    /// <summary>
    /// Whether the account ended its sessions after this one began: it has ended them, the session's
    /// stamp is not the account's, and the session began no later than the ending. A session that says
    /// nothing of when it began is taken to be older.
    /// </summary>
    internal static bool Ended(
        DateTimeOffset? sessionsEndedAt, string? accountStamp, string? sessionStamp, DateTimeOffset? issuedUtc) =>
        sessionsEndedAt is { } ended
        && !string.Equals(sessionStamp, accountStamp, StringComparison.Ordinal)
        && (issuedUtc is not { } issued || issued <= ended);
}
