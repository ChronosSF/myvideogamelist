using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// How each account's withdrawals are paced on their way to the edge: which go at once, which wait,
/// what goes together, and that nothing waiting is ever lost (ADR 0081).
/// </summary>
/// <remarks>
/// On a clock moved by hand whose timers fire as it passes them, so a fifteen-minute wait is a step of
/// the clock. What the paced invalidations are handed to is a recording edge.
/// </remarks>
public class WithdrawalHoldTests
{
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private static EdgeInvalidation Withdrawal(string account, string reason, params string[] paths) =>
        new(reason, paths) { Account = account };

    /// <summary>A clock that stands still until moved, and fires each timer as it passes it.</summary>
    private sealed class SteppedClock(DateTimeOffset start) : TimeProvider
    {
        private readonly List<SteppedTimer> timers = [];
        private DateTimeOffset now = start;

        public override DateTimeOffset GetUtcNow() => now;

        public int Pending => timers.Count(t => !t.Disposed);

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            var timer = new SteppedTimer(callback, state, now + dueTime);
            timers.Add(timer);
            return timer;
        }

        public void Advance(TimeSpan by)
        {
            var until = now + by;
            while (timers.Where(t => !t.Disposed && t.DueAt <= until).MinBy(t => t.DueAt) is { } next)
            {
                now = next.DueAt;
                next.Disposed = true;
                next.Callback(next.State);
            }

            timers.RemoveAll(t => t.Disposed);
            now = until;
        }

        private sealed class SteppedTimer(TimerCallback callback, object? state, DateTimeOffset dueAt) : ITimer
        {
            public TimerCallback Callback => callback;
            public object? State => state;
            public DateTimeOffset DueAt => dueAt;
            public bool Disposed { get; set; }

            public bool Change(TimeSpan dueTime, TimeSpan period) => false;
            public void Dispose() => Disposed = true;
            public ValueTask DisposeAsync()
            {
                Disposed = true;
                return ValueTask.CompletedTask;
            }
        }
    }

    private static WithdrawalHold Hold(
        IEdgeInvalidator inner, TimeProvider clock, WithdrawalHold.Pacing? pacing = null, ILogger<WithdrawalHold>? logger = null) =>
        new(inner, clock, logger ?? NullLogger<WithdrawalHold>.Instance, pacing ?? WithdrawalHold.Pacing.Default);

    [Fact]
    public void Invalidate_FirstFromAnAccount_GoesAtOnce()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));

        var sent = Assert.Single(edge.Sent);
        Assert.Equal(["/u/alice*"], sent.Paths);
        Assert.Null(sent.WrittenAt);
        Assert.Equal(0, clock.Pending);
    }

    [Fact]
    public void Invalidate_MoreWithinTheMinute_WaitForItAndGoTogether()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));
        clock.Advance(TimeSpan.FromSeconds(10));
        hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));
        clock.Advance(TimeSpan.FromSeconds(20));
        hold.Invalidate(Withdrawal("alice-id", "review edited", "/u/alice*"));

        Assert.Single(edge.Sent);

        clock.Advance(TimeSpan.FromSeconds(29));
        Assert.Single(edge.Sent);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.Equal(2, edge.Sent.Count);
        var together = edge.Sent[1];
        Assert.Equal(["/u/alice*"], together.Paths);
        Assert.Equal("entry deleted, review edited", together.Reason);
        Assert.Equal("alice-id", together.Account);
        // The latest write it covers, so the sender's retries stop sixty-five minutes after that.
        Assert.Equal(Midday + TimeSpan.FromSeconds(30), together.WrittenAt);
    }

    [Fact]
    public void Invalidate_AMinuteAfterTheLastSend_GoesAtOnce()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));
        clock.Advance(TimeSpan.FromMinutes(1));
        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));

        Assert.Equal(2, edge.Sent.Count);
        Assert.Equal(0, clock.Pending);
    }

    [Fact]
    public void Invalidate_SomebodyDeletingAGameAMinuteForTwentyMinutes_NeverWaits()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        for (var minute = 0; minute < 20; minute++)
        {
            hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));
            Assert.Equal(minute + 1, edge.Sent.Count);
            clock.Advance(TimeSpan.FromMinutes(1));
        }
    }

    [Fact]
    public void Invalidate_PastTheBurst_WaitsForTheBucketToRefill()
    {
        // The bucket alone, without the minute between sends.
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock, new WithdrawalHold.Pacing(TimeSpan.Zero, Burst: 3, Refill: TimeSpan.FromMinutes(15)));

        for (var i = 0; i < 4; i++) hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));

        Assert.Equal(3, edge.Sent.Count);

        clock.Advance(TimeSpan.FromMinutes(15) - TimeSpan.FromSeconds(1));
        Assert.Equal(3, edge.Sent.Count);

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.Equal(4, edge.Sent.Count);
    }

    [Fact]
    public void Invalidate_AScriptWithdrawingAllDay_IsSentAtMost116TimesAndNothingWaitsPastFifteenMinutes()
    {
        // The bound ADR 0081 §5 states: twenty, then one every fifteen minutes; and every withdrawal
        // reaches the edge, none later than fifteen minutes after it was made.
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);
        var made = new List<DateTimeOffset>();
        var sentAt = new List<DateTimeOffset>();
        edge.OnInvalidate = _ => sentAt.Add(clock.GetUtcNow());

        for (var step = 0; step < 24 * 60 * 2; step++)
        {
            made.Add(clock.GetUtcNow());
            hold.Invalidate(Withdrawal("script-id", "entry deleted", "/u/script*"));
            clock.Advance(TimeSpan.FromSeconds(30));
        }

        clock.Advance(TimeSpan.FromMinutes(15));

        Assert.InRange(sentAt.Count(at => at < Midday.AddDays(1)), 100, 116);
        Assert.All(made, at => Assert.Contains(sentAt, sent => sent >= at && sent - at <= TimeSpan.FromMinutes(15)));
    }

    [Fact]
    public void Invalidate_AtOnce_GoesAtOnceCarryingWhatTheAccountHadWaiting()
    {
        // The privacy switch never waits behind its owner's own review deletions, and what was
        // waiting goes with it rather than costing a path of its own later.
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));
        hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));
        hold.Invalidate(new EdgeInvalidation("profile made private", ["/u/alice*", "/sitemaps/profiles-*"])
        {
            Account = "alice-id",
            AtOnce = true,
        });

        Assert.Equal(2, edge.Sent.Count);
        var atOnce = edge.Sent[1];
        Assert.Equal(["/u/alice*", "/sitemaps/profiles-*"], atOnce.Paths);
        Assert.Equal("profile made private, entry deleted", atOnce.Reason);
        Assert.Null(atOnce.WrittenAt);

        clock.Advance(TimeSpan.FromHours(1));
        Assert.Equal(2, edge.Sent.Count);
    }

    [Fact]
    public void Invalidate_AtOnceAfterARenameWasWaiting_CarriesTheOldNameToo()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));
        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alicia*"));
        hold.Invalidate(new EdgeInvalidation("account deleted", ["/u/Alicia*", "/sitemaps/profiles-*"])
        {
            Account = "alice-id",
            AtOnce = true,
        });

        Assert.Equal(["/u/Alicia*", "/sitemaps/profiles-*", "/u/alicia*"], edge.Sent[1].Paths);
    }

    [Fact]
    public void Invalidate_AtOnce_SpendsNothingOfTheAccountsPace()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(new EdgeInvalidation("profile renamed", ["/u/alice*", "/u/Alice*"]) { Account = "alice-id", AtOnce = true });
        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/Alice*"));

        Assert.Equal(2, edge.Sent.Count);
    }

    [Fact]
    public void Invalidate_TwoAccounts_ArePacedApart()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));
        hold.Invalidate(Withdrawal("bob-id", "review deleted", "/u/bob*"));

        Assert.Equal(["/u/alice*", "/u/bob*"], edge.Sent.Select(sent => sent.Paths.Single()));
    }

    [Fact]
    public void Invalidate_NobodysPaths_PassStraightThrough()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);

        hold.Invalidate(new EdgeInvalidation("sitemaps", ["/sitemaps/profiles-*"]));
        hold.Invalidate(new EdgeInvalidation("sitemaps", ["/sitemaps/profiles-*"]));

        Assert.Equal(2, edge.Sent.Count);
    }

    [Fact]
    public void Flush_StoppingWithWithdrawalsWaiting_SendsThemAndPassesEverythingAfterStraightThrough()
    {
        var edge = new RecordingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock);
        hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*"));
        hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));

        hold.Flush();

        Assert.Equal(2, edge.Sent.Count);
        Assert.Equal(0, clock.Pending);

        hold.Invalidate(Withdrawal("alice-id", "review edited", "/u/alice*"));
        Assert.Equal(3, edge.Sent.Count);
    }

    [Fact]
    public void Release_TheEdgeThrows_IsLoggedRatherThanEscapingTheTimer()
    {
        // An exception escaping a timer's callback ends the process.
        var logger = new ListLogger<WithdrawalHold>();
        var edge = new ThrowingEdgeInvalidator();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(edge, clock, logger: logger);
        Assert.Throws<InvalidOperationException>(() => hold.Invalidate(Withdrawal("alice-id", "review deleted", "/u/alice*")));
        hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));

        clock.Advance(TimeSpan.FromMinutes(1));

        Assert.Equal(2, edge.Calls);
        var error = Assert.Single(logger.At(LogLevel.Error));
        Assert.Contains("/u/alice*", error.Message);
    }

    [Fact]
    public void Invalidate_Held_IsLoggedOncePerWaitWithItsPaths()
    {
        // A loop that is being paced cannot fill the log as fast as it saves.
        var logger = new ListLogger<WithdrawalHold>();
        var clock = new SteppedClock(Midday);
        using var hold = Hold(new RecordingEdgeInvalidator(), clock, logger: logger);

        for (var i = 0; i < 5; i++) hold.Invalidate(Withdrawal("alice-id", "entry deleted", "/u/alice*"));

        var held = Assert.Single(logger.At(LogLevel.Information));
        Assert.Contains("/u/alice*", held.Message);
        Assert.DoesNotContain("alice-id", string.Join(" ", logger.Entries.Select(e => e.Message)));
    }
}
