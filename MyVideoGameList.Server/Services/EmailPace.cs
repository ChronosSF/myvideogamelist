using Microsoft.Extensions.Caching.Memory;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// One email of a kind to an account every <see cref="Interval"/> at most: the confirmation (ADR 0089),
/// and the password reset (ADR 0090), each on its own.
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
/// <b>Claimed before the send, and released if the send fails</b>, so that a request arriving while the
/// first is still out finds the claim, and trying again a moment after a failure works. The claim is
/// made under a lock, because the cache's own <c>GetOrCreate</c> lets two simultaneous callers both find
/// nothing and both send. Static, because the services that claim are scoped and the cache is not; the
/// lock is held for a lookup and a write, never across a send.
/// </para>
/// <para>
/// <b>Kept in memory, per task.</b> The dev environment runs one task. With several, an account could be
/// sent one of each per task per window: a handful, not a flood. #420's <c>EmailDeliveries</c> is where an
/// exact count would go.
/// </para>
/// </remarks>
public static class EmailPace
{
    /// <summary>The least time between two emails of one kind to one account.</summary>
    public static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    private static readonly Lock Claims = new();

    /// <summary>
    /// Claims the next <see cref="Interval"/> for an email of <paramref name="kind"/> to the account, or
    /// answers false when one was claimed within it.
    /// </summary>
    public static bool TryClaim(IMemoryCache cache, string kind, string accountId)
    {
        var key = Key(kind, accountId);
        lock (Claims)
        {
            if (cache.TryGetValue(key, out _)) return false;
            cache.Set(key, true, Interval);
            return true;
        }
    }

    /// <summary>Gives a claim back, for a send that did not go.</summary>
    public static void Release(IMemoryCache cache, string kind, string accountId) => cache.Remove(Key(kind, accountId));

    private static string Key(string kind, string accountId) => $"{kind}-sent:{accountId}";
}
