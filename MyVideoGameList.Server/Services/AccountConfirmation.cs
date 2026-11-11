using Microsoft.AspNetCore.Identity;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Email;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Sends an account the link that confirms its address, at most once every <see cref="EmailPace.Interval"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>The pace is per account, and it is why a resend cannot be used to flood an inbox.</b> It is
/// <see cref="EmailPace"/>'s, which says why, and in which the password reset keeps a pace of its own
/// (ADR 0090). A send that did not go gives its claim back, so trying again a moment later works.
/// </para>
/// <para>
/// <b>Never cancelled by the caller.</b> The account is already written when this runs, and a reader
/// closing the tab must not cost them the email that lets them use it.
/// </para>
/// </remarks>
public sealed class AccountConfirmation(
    UserManager<ApplicationUser> users,
    AccountEmails emails,
    EmailPace pace)
{
    public Task<EmailSend> SendAsync(ApplicationUser user) =>
        pace.SendAsync(
            "confirmation",
            user.Id,
            () => users.GenerateEmailConfirmationTokenAsync(user),
            token => emails.SendConfirmationAsync(user, token, CancellationToken.None));
}
