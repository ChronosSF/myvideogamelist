using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Email;

namespace MyVideoGameList.Server.Services;

/// <summary>What became of a request to send an account its confirmation.</summary>
public enum ConfirmationSend
{
    /// <summary>The email went to the sending service.</summary>
    Sent,

    /// <summary>One went to this account within <see cref="AccountConfirmation.Pace"/>, so none went now.</summary>
    Paced,

    /// <summary>The sending service did not take it. The transport has logged why.</summary>
    Failed,
}

/// <summary>
/// Sends an account the link that confirms its address, at most once every <see cref="Pace"/>.
/// </summary>
/// <remarks>
/// <para>
/// <b>The pace is per account, and it is why a resend cannot be used to flood an inbox.</b> It is
/// <see cref="EmailPace"/>'s, which says why, and which the password reset keeps a pace of its own in
/// (ADR 0090). A send that failed lifts the pace, so trying again a moment later works.
/// </para>
/// <para>
/// <b>Never cancelled by the caller.</b> The account is already written when this runs, and a reader
/// closing the tab must not cost them the email that lets them use it.
/// </para>
/// </remarks>
public sealed class AccountConfirmation(
    UserManager<ApplicationUser> users,
    AccountEmails emails,
    IMemoryCache cache,
    ILogger<AccountConfirmation> logger)
{
    /// <summary>The least time between two confirmations to one account.</summary>
    public static readonly TimeSpan Pace = EmailPace.Interval;

    /// <summary>The confirmation's own pace, apart from the reset's (<see cref="EmailPace"/>).</summary>
    private const string Kind = "confirmation";

    public async Task<ConfirmationSend> SendAsync(ApplicationUser user)
    {
        if (!EmailPace.TryClaim(cache, Kind, user.Id)) return ConfirmationSend.Paced;

        string token;
        try
        {
            token = await users.GenerateEmailConfirmationTokenAsync(user);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // The token is protected with the key ring, which a deployment that cannot read its store
            // fails on at first use (ADR 0043). The account is written by now, so this is an email that
            // did not go, not a failed registration, and the pace is lifted so a later try can send.
            logger.LogError(exception, "The account confirmation's token could not be made.");
            EmailPace.Release(cache, Kind, user.Id);
            return ConfirmationSend.Failed;
        }

        try
        {
            await emails.SendConfirmationAsync(user, token, CancellationToken.None);
            return ConfirmationSend.Sent;
        }
        catch (EmailNotSentException)
        {
            EmailPace.Release(cache, Kind, user.Id);
            return ConfirmationSend.Failed;
        }
    }
}
