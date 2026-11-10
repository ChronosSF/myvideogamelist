using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Email;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// A forgotten password: the link that sets a new one, sent at most once every
/// <see cref="EmailPace.Interval"/>, and the reset it leads to (ADR 0090).
/// </summary>
public sealed class PasswordReset(
    UserManager<ApplicationUser> users,
    AccountEmails emails,
    IMemoryCache cache,
    TimeProvider clock,
    ILogger<PasswordReset> logger)
{
    /// <summary>The reset's own pace, apart from the confirmation's (<see cref="EmailPace"/>).</summary>
    private const string Kind = "password-reset";

    /// <summary>
    /// Sends the account its link, unless one went within the pace. True when an email went.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Every account is sent one, confirmed or not and locked out or not: a reset proves the address as a
    /// confirmation does, and ends a lockout, so it is the one email that helps an account that is both
    /// unconfirmed and without its password.
    /// </para>
    /// <para>
    /// Never cancelled by the caller once begun, as the confirmation is not: the controller checks before
    /// calling, so nobody who has gone is sent one, and nobody still waiting loses one half-sent.
    /// </para>
    /// </remarks>
    public async Task<bool> SendAsync(ApplicationUser user)
    {
        if (!EmailPace.TryClaim(cache, Kind, user.Id)) return false;

        string token;
        try
        {
            token = await users.GeneratePasswordResetTokenAsync(user);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The key ring, unreadable on a deployment that cannot reach its store (ADR 0043).
            logger.LogError(exception, "The password reset's token could not be made.");
            EmailPace.Release(cache, Kind, user.Id);
            return false;
        }

        try
        {
            await emails.SendPasswordResetAsync(user, token, CancellationToken.None);
            return true;
        }
        catch (EmailNotSentException)
        {
            EmailPace.Release(cache, Kind, user.Id);
            return false;
        }
    }

    /// <summary>
    /// Sets a new password from a link's token, and with it confirms the address, ends any lockout, and
    /// ends every session the account had.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>One write, or none.</b> Identity's <see cref="UserManager{TUser}.ResetPasswordAsync"/> checks the
    /// token, then the password, and only then writes the account once, with a new hash and a new
    /// security stamp; a failure at either check writes nothing. The four fields set here before it are
    /// carried by that one write, so a reset never half happens. Nothing else in the request writes the
    /// account, so a refused reset leaves them unsaved.
    /// </para>
    /// <para>
    /// <b>The address is confirmed</b>, because the token was sent to it and has come back: what a
    /// confirmation proves. The new stamp has already spent every confirmation link, as it spends every
    /// other reset link.
    /// </para>
    /// <para>
    /// <b>The lockout ends.</b> Identity leaves the failure count and the lockout as they were, so five
    /// guesses by anybody, at any address, would keep its owner out of an account whose password they
    /// have just set, told for fifteen minutes that it is wrong. The link proves more than a password.
    /// </para>
    /// <para>
    /// <b>Every session ends at its next request</b>, through <see cref="ApplicationUser.SessionsEndedAt"/>,
    /// rather than at Identity's check of the new stamp, up to half an hour later: somebody resetting a
    /// password may be doing it because somebody else has it.
    /// </para>
    /// </remarks>
    public Task<IdentityResult> ResetAsync(ApplicationUser user, string token, string newPassword)
    {
        user.EmailConfirmed = true;
        user.AccessFailedCount = 0;
        user.LockoutEnd = null;
        user.SessionsEndedAt = clock.GetUtcNow();

        return users.ResetPasswordAsync(user, token, newPassword);
    }
}
