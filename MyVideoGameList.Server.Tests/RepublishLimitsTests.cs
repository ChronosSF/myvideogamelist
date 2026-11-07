using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The day's allowance of the two writes that let an urgent withdrawal repeat (ADR 0081 §4): how it
/// is counted, per whom, and what a refusal says. The endpoints that consult it are under test in
/// <see cref="ProfileWithdrawalTests"/>.
/// </summary>
public class RepublishLimitsTests
{
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    [Theory]
    [InlineData(Republish.ProfilePublic, 10)]
    [InlineData(Republish.NameCase, 3)]
    public void TryTake_PastTheAllowance_IsRefusedUntilTheFirstIsADayOld(Republish act, int allowance)
    {
        var clock = new ManualClock(Midday);
        var limits = new RepublishLimits(clock);

        for (var i = 0; i < allowance; i++)
        {
            Assert.True(limits.TryTake(act, "alice-id", out _));
            clock.Advance(TimeSpan.FromMinutes(10));
        }

        Assert.False(limits.TryTake(act, "alice-id", out var wait));
        // The first was taken at midday, and comes back a day after it.
        Assert.Equal(Midday.AddDays(1) - clock.GetUtcNow(), wait);

        clock.Advance(wait - TimeSpan.FromSeconds(1));
        Assert.False(limits.TryTake(act, "alice-id", out _));

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(limits.TryTake(act, "alice-id", out _));
        Assert.False(limits.TryTake(act, "alice-id", out _));
    }

    [Fact]
    public void TryTake_EachAccountAndEachAct_CountsApart()
    {
        var limits = new RepublishLimits(new ManualClock(Midday));
        while (limits.TryTake(Republish.ProfilePublic, "alice-id", out _)) { }

        Assert.True(limits.TryTake(Republish.ProfilePublic, "bob-id", out _));
        Assert.True(limits.TryTake(Republish.NameCase, "alice-id", out _));
    }

    [Fact]
    public void TryTake_AfterADayOfNothing_IsAFullAllowanceAgain()
    {
        // The sweep forgets an account whose allowance has all come back; nothing about it changes.
        var clock = new ManualClock(Midday);
        var limits = new RepublishLimits(clock);
        while (limits.TryTake(Republish.NameCase, "alice-id", out _)) { }

        clock.Advance(TimeSpan.FromDays(2));

        for (var i = 0; i < RepublishLimits.Allowance(Republish.NameCase); i++)
            Assert.True(limits.TryTake(Republish.NameCase, "alice-id", out _));
        Assert.False(limits.TryTake(Republish.NameCase, "alice-id", out _));
    }

    [Theory]
    [InlineData(20, "a minute")]
    [InlineData(60, "a minute")]
    [InlineData(61, "2 minutes")]
    [InlineData(40 * 60, "40 minutes")]
    [InlineData(60 * 60, "about an hour")]
    [InlineData(89 * 60, "about an hour")]
    [InlineData(90 * 60, "about 2 hours")]
    [InlineData(23 * 3600 + 50 * 60, "about 24 hours")]
    public void InWords_AWait_IsSaidAsAPersonWouldSayIt(int seconds, string expected) =>
        Assert.Equal(expected, RepublishLimits.InWords(TimeSpan.FromSeconds(seconds)));

    [Fact]
    public void Refusal_ForTheSwitch_SaysWhenAndThatMakingItPrivateIsNeverLimited() =>
        Assert.Equal(
            "A profile can be made public 10 times a day, and yours has been. You can make it public again "
            + "in about 3 hours. Making it private is never limited.",
            RepublishLimits.Refusal(Republish.ProfilePublic, TimeSpan.FromHours(3)));

    [Fact]
    public void Refusal_ForAChangeOfCase_SaysWhen() =>
        Assert.Equal(
            "The letter case of a public profile's username can be changed 3 times a day, and yours has "
            + "been. You can change it again in 40 minutes.",
            RepublishLimits.Refusal(Republish.NameCase, TimeSpan.FromMinutes(40)));
}
