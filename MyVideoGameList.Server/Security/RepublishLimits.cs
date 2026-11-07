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

    private readonly Dictionary<(Republish, string), List<DateTimeOffset>> taken = [];
    private readonly Lock gate = new();
    private DateTimeOffset nextSweep;

    /// <summary>
    /// Counts one, if the account has any left in the last day, and says otherwise how long until it
    /// has. Dispose the permit, and call <see cref="RepublishPermit.Keep"/> once the write it allowed
    /// is saved.
    /// </summary>
    /// <remarks>
    /// Counted before the write it allows, so two requests at once cannot both take the last one, and
    /// handed back if that write is not saved: a lost race answered with a 409, or a failure, is not a
    /// publication, and must not cost the account one of its day's allowance.
    /// </remarks>
    public RepublishPermit Take(Republish act, string userId)
    {
        lock (gate)
        {
            var now = clock.GetUtcNow();
            Sweep(now);

            var key = (act, userId);
            if (!taken.TryGetValue(key, out var times)) taken[key] = times = [];
            times.RemoveAll(at => at + Window <= now);

            if (times.Count < Allowance(act))
            {
                times.Add(now);
                return RepublishPermit.Granted(this, act, userId, now);
            }

            // The earliest, not the first: a clock stepped back can leave the list out of order.
            return RepublishPermit.Refused(times.Min() + Window - now);
        }
    }

    /// <summary>Hands back one counted use, the one taken at <paramref name="takenAt"/>.</summary>
    internal void GiveBack(Republish act, string userId, DateTimeOffset takenAt)
    {
        lock (gate)
        {
            if (taken.TryGetValue((act, userId), out var times)) times.Remove(takenAt);
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
            if (times.Count == 0 || times.Max() + Window <= now) taken.Remove(key);
        }
    }
}

/// <summary>
/// One use of an account's daily allowance: counted as soon as it is taken, and handed back when it is
/// disposed unless <see cref="Keep"/> says the write it allowed was saved.
/// </summary>
public sealed class RepublishPermit : IDisposable
{
    private readonly RepublishLimits? limits;
    private readonly Republish act;
    private readonly string userId;
    private readonly DateTimeOffset takenAt;
    private bool settled;

    private RepublishPermit(
        RepublishLimits? limits, Republish act, string userId, DateTimeOffset takenAt, TimeSpan retryAfter)
    {
        this.limits = limits;
        this.act = act;
        this.userId = userId;
        this.takenAt = takenAt;
        RetryAfter = retryAfter;
    }

    internal static RepublishPermit Granted(RepublishLimits limits, Republish act, string userId, DateTimeOffset at) =>
        new(limits, act, userId, at, TimeSpan.Zero);

    internal static RepublishPermit Refused(TimeSpan retryAfter) =>
        new(null, default, "", default, retryAfter);

    /// <summary>Whether the account had one left; when not, nothing was counted.</summary>
    public bool IsGranted => limits is not null;

    /// <summary>For a refusal, how long until the account has one again.</summary>
    public TimeSpan RetryAfter { get; }

    /// <summary>The write this allowed was saved, so the use stays counted.</summary>
    public void Keep() => settled = true;

    public void Dispose()
    {
        if (settled || limits is null) return;
        settled = true;
        limits.GiveBack(act, userId, takenAt);
    }
}
