using System.Globalization;

namespace MyVideoGameList.Server.Security;

/// <summary>The two acts one account is limited in, because each lets an urgent withdrawal repeat.</summary>
public enum Republish
{
    /// <summary>A profile that was not public, made public.</summary>
    ProfilePublic,

    /// <summary>A public profile's username, changed in letter case only.</summary>
    NameCase,
}

/// <summary>
/// How often one account may make its profile public, or change the letter case of a public
/// profile's name: the two writes that let a withdrawal sent to the edge at once be repeated.
/// </summary>
/// <remarks>
/// <para>
/// <b>Never a withdrawal.</b> Making a profile private, renaming it and deleting the account go to the
/// edge at once (ADR 0081 §3), and refusing one of them would leave the profile public at the origin
/// as well as at the edge. What makes them repeatable is what is limited instead: a profile cannot be
/// made private again until it has been made public, and a change of case is what makes the next one
/// name a spelling the last did not. A full rename waits thirty days already, and an account is
/// deleted once.
/// </para>
/// <para>
/// <b>Partitioned by account, not by address</b>, so the server render, which makes every loader's
/// calls from one address, is never one bucket (ADR 0033 §2) — and no loader calls either write.
/// Checked in the action rather than as a rate-limiting policy, because the privacy switch takes both
/// directions on one endpoint and a policy could not tell the one it may refuse from the one it must
/// never.
/// </para>
/// <para>
/// <b>A sliding log of the last day</b>, per account and act, rather than the framework's sliding
/// window: <c>System.Threading.RateLimiting</c> takes no <see cref="TimeProvider"/>, and a day's
/// window has to be testable without a day. Per task and in memory, as the auth limiter's partitions
/// are: two tasks give an account twice the allowance.
/// </para>
/// </remarks>
public sealed class RepublishLimits(TimeProvider clock)
{
    /// <summary>The window every allowance is counted over.</summary>
    internal static readonly TimeSpan Window = TimeSpan.FromDays(1);

    /// <summary>
    /// How many of each a day. Ten for the switch, far above somebody trying both settings to see what
    /// the page looks like, and twenty paths a day at most. Three for a change of case, which is how a
    /// name capitalised wrongly is put right, and three paths each.
    /// </summary>
    internal static int Allowance(Republish act) => act switch
    {
        Republish.ProfilePublic => 10,
        Republish.NameCase => 3,
        _ => throw new ArgumentOutOfRangeException(nameof(act)),
    };

    private readonly Dictionary<(Republish, string), Queue<DateTimeOffset>> taken = [];
    private readonly Lock gate = new();
    private DateTimeOffset nextSweep;

    /// <summary>
    /// Counts one, if the account has any left in the last day; otherwise says how long until it has.
    /// </summary>
    /// <remarks>
    /// Counted before the write it allows, so two requests at once cannot both take the last one. A
    /// write that then fails has spent it, as an attempt spends the auth limiter's.
    /// </remarks>
    public bool TryTake(Republish act, string userId, out TimeSpan retryAfter)
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            Sweep(now);

            var key = (act, userId);
            if (!taken.TryGetValue(key, out var times)) taken[key] = times = new Queue<DateTimeOffset>();
            while (times.TryPeek(out var oldest) && oldest + Window <= now) times.Dequeue();

            if (times.Count < Allowance(act))
            {
                times.Enqueue(now);
                retryAfter = TimeSpan.Zero;
                return true;
            }

            retryAfter = times.Peek() + Window - now;
            return false;
        }
    }

    /// <summary>
    /// What the refusal says: what was refused, when it can be done again, and, for the switch, that
    /// taking the profile back is never what is limited.
    /// </summary>
    internal static string Refusal(Republish act, TimeSpan retryAfter) => act switch
    {
        Republish.ProfilePublic =>
            $"A profile can be made public {Allowance(act)} times a day, and yours has been. You can make it "
            + $"public again in {InWords(retryAfter)}. Making it private is never limited.",
        Republish.NameCase =>
            $"The letter case of a public profile's username can be changed {Allowance(act)} times a day, and "
            + $"yours has been. You can change it again in {InWords(retryAfter)}.",
        _ => throw new ArgumentOutOfRangeException(nameof(act)),
    };

    /// <summary>A wait as a person would say it: in minutes under an hour, in hours over it.</summary>
    internal static string InWords(TimeSpan wait)
    {
        if (wait <= TimeSpan.FromMinutes(1)) return "a minute";

        if (wait < TimeSpan.FromMinutes(60))
            return $"{Math.Ceiling(wait.TotalMinutes).ToString(CultureInfo.InvariantCulture)} minutes";

        var hours = (int)Math.Round(wait.TotalHours, MidpointRounding.AwayFromZero);
        return hours <= 1 ? "about an hour" : $"about {hours.ToString(CultureInfo.InvariantCulture)} hours";
    }

    /// <summary>
    /// Forgets the accounts with nothing left in the window, at most once an hour, so a request does
    /// not walk the whole table.
    /// </summary>
    private void Sweep(DateTimeOffset now)
    {
        if (now < nextSweep) return;
        nextSweep = now + TimeSpan.FromHours(1);

        foreach (var (key, times) in taken)
        {
            if (times.Count == 0 || times.Last() + Window <= now) taken.Remove(key);
        }
    }
}
