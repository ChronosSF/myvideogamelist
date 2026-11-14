using Microsoft.AspNetCore.Identity;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services.Email;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// A forgotten password: the link that sets a new one, sent at most once every
/// <see cref="EmailPace.Interval"/>, and the reset it leads to (ADR 0090).
/// </summary>
public sealed class PasswordReset(
    UserManager<ApplicationUser> users,
    AccountEmails emails,
    EmailPace pace,
    TimeProvider clock)
{
    /// <summary>Sends the account its link, unless one went within the pace.</summary>
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
    public Task<EmailSend> SendAsync(ApplicationUser user) =>
        pace.SendAsync(
            "password-reset",
            user.Id,
            () => users.GeneratePasswordResetTokenAsync(user),
            token => emails.SendPasswordResetAsync(user, token, CancellationToken.None));

    /// <summary>
    /// Sets a new password from a link's token, and with it confirms the address, ends any lockout, and
    /// ends every session the account had.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>One write, or none.</b> Identity's <see cref="UserManager{TUser}.ResetPasswordAsync"/> checks the
    /// token, then the password, and only then writes the account once, with a new hash and a new
    /// security stamp; a failure at either check writes nothing. The four fields set here before it are
    /// carried by that one write, so a reset never half happens, and put back as they were when it is
    /// refused, so that nothing saved later in the request can carry them for a token that was no good.
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
    /// <b>Every session ends at its next request</b> (<see cref="AccountSessions.EndAll"/>), rather than at
    /// Identity's check of the new stamp, up to half an hour later: somebody resetting a password may be
    /// doing it because somebody else has it. The new stamp is the half of that the reset itself writes.
    /// </para>
    /// </remarks>
    public async Task<IdentityResult> ResetAsync(ApplicationUser user, string token, string newPassword)
    {
        var before = (user.EmailConfirmed, user.AccessFailedCount, user.LockoutEnd, user.SessionsEndedAt);

        user.EmailConfirmed = true;
        user.AccessFailedCount = 0;
        user.LockoutEnd = null;
        AccountSessions.EndAll(user, clock.GetUtcNow());

        var result = await users.ResetPasswordAsync(user, token, newPassword);
        if (!result.Succeeded)
            (user.EmailConfirmed, user.AccessFailedCount, user.LockoutEnd, user.SessionsEndedAt) = before;

        return result;
    }
}
