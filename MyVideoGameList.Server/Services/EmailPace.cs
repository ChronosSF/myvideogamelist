using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Services.Email;

namespace MyVideoGameList.Server.Services;

/// <summary>What became of a request to send an account one of its emails.</summary>
public enum EmailSend
{
    /// <summary>The email went to the sending service.</summary>
    Sent,

    /// <summary>One of its kind went to this account within <see cref="EmailPace.Interval"/>, so none went now.</summary>
    Paced,

    /// <summary>
    /// Nothing went: its token could not be made, which is logged here, or the sending service did not take
    /// it, which the transport has logged.
    /// </summary>
    Failed,
}

/// <summary>
/// One email of a kind to an account every <see cref="Interval"/> at most: the confirmation (ADR 0089),
/// and the password reset (ADR 0090), each on its own. Every paced email goes through
/// <see cref="SendAsync"/>, the whole of the sequence, so that a third kind cannot get it half right.
/// </summary>
/// <remarks>
/// <para>
/// <b>Per account, because the recipient is what needs protecting.</b> Anybody can ask for either email
/// to be sent to any address, so the limit that matters is on the inbox; the rate limiter covers the
/// caller's network address. Five minutes is the "every few minutes" the request to AWS for production
/// access promised (#418).
/// </para>
/// <para>
/// <b>Per kind, not shared.</b> A confirmation sent at sign-up must not hold back the reset somebody asks
/// for a minute later, having mistyped the password they chose: the reset is what lets them in, and it
/// confirms the address as it goes. So one account may be sent one of each in five minutes, two emails,
/// and never more than one reset.
/// </para>
/// <para>
/// <b>Claimed before the send, and given back whenever nothing went</b>, so that a request arriving while
/// the first is still out finds the claim, and trying again a moment after any failure works. The claim
/// is made under a lock, because the cache's own <c>GetOrCreate</c> lets two simultaneous callers both
/// find nothing and both send. The lock is held for a lookup and a write, never across a send. A
/// singleton, so that one lock guards one cache.
/// </para>
/// <para>
/// <b>Kept in memory, per task.</b> The dev environment runs one task. With several, an account could be
/// sent one of each per task per window: a handful, not a flood. #420's <c>EmailDeliveries</c> is where an
/// exact count would go.
/// </para>
/// </remarks>
public sealed class EmailPace(IMemoryCache cache, ILogger<EmailPace> logger)
{
    /// <summary>The least time between two emails of one kind to one account.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    private readonly Lock claims = new();

    /// <summary>
    /// Makes the email's token and sends it, unless one of <paramref name="kind"/> went to the account
    /// within the pace.
    /// </summary>
    /// <remarks>
    /// A token that cannot be made is an email that did not go, not a failure of the request that asked:
    /// it is protected with the key ring, which a deployment that cannot read its store fails on at first
    /// use (ADR 0043), and by then the account is written. Anything else that escapes is a bug of ours, or
    /// the caller's cancellation, and is thrown on, with the claim given back all the same.
    /// </remarks>
    public async Task<EmailSend> SendAsync(
        string kind, string accountId, Func<Task<string>> makeToken, Func<string, Task> send)
    {
        var key = $"{kind}-sent:{accountId}";
        lock (claims)
        {
            if (cache.TryGetValue(key, out _)) return EmailSend.Paced;
            cache.Set(key, true, Interval);
        }

        string? token = null;
        try
        {
            token = await makeToken();
            await send(token);
            return EmailSend.Sent;
        }
        catch (EmailNotSentException)
        {
            cache.Remove(key);
            return EmailSend.Failed;
        }
        catch (Exception exception) when (token is null && exception is not OperationCanceledException)
        {
            logger.LogError(exception, "The {Kind} email's token could not be made.", kind);
            cache.Remove(key);
            return EmailSend.Failed;
        }
        catch
        {
            cache.Remove(key);
            throw;
        }
    }
}
