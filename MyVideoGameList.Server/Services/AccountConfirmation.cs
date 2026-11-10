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
/// <b>The pace is per account, and it is why a resend cannot be used to flood an inbox.</b> Anybody can
/// ask for a confirmation to be sent again to any address that has an unconfirmed account, so the limit
/// that matters is on the recipient, not on the caller's network address, which the rate limiter already
/// covers. Five minutes is the "every few minutes" the request to AWS for production access promised
/// (#418). A send that failed lifts the pace, so trying again a moment later works.
/// </para>
/// <para>
/// <b>Kept in memory, per task.</b> The dev environment runs one task. With several, an account could be
/// sent one confirmation per task per window, which is still a handful, not a flood. A table would make it
/// exact; #420's <c>EmailDeliveries</c> is the place for that if it is ever needed.
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
    public static readonly TimeSpan Pace = TimeSpan.FromMinutes(5);

    /// <summary>Makes a claim on the pace one step. Static, because the service is scoped and the cache is not.</summary>
    private static readonly Lock Claims = new();

    public async Task<ConfirmationSend> SendAsync(ApplicationUser user)
    {
        var key = $"confirmation-sent:{user.Id}";

        // Claimed before the send rather than after it, so a request arriving while the first is still
        // out finds the claim, and under a lock, because the cache's own GetOrCreate lets two
        // simultaneous callers both find nothing and both send. The lock is held for a lookup and a
        // write, never across the send.
        lock (Claims)
        {
            if (cache.TryGetValue(key, out _)) return ConfirmationSend.Paced;
            cache.Set(key, true, Pace);
        }

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
            cache.Remove(key);
            return ConfirmationSend.Failed;
        }

        try
        {
            await emails.SendConfirmationAsync(user, token, CancellationToken.None);
            return ConfirmationSend.Sent;
        }
        catch (EmailNotSentException)
        {
            cache.Remove(key);
            return ConfirmationSend.Failed;
        }
    }
}
