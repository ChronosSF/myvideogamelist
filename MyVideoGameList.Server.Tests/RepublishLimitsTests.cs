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

    /// <summary>Takes one and keeps it, as a write that was saved does.</summary>
    private static bool Spend(RepublishLimits limits, Republish act, string userId)
    {
        using var permit = limits.Take(act, userId);
        permit.Keep();
        return permit.IsGranted;
    }

    [Theory]
    [InlineData(Republish.ProfilePublic, 10)]
    [InlineData(Republish.NameCase, 3)]
    public void Take_PastTheAllowance_IsRefusedUntilTheFirstIsADayOld(Republish act, int allowance)
    {
        var clock = new ManualClock(Midday);
        var limits = new RepublishLimits(clock);

        for (var i = 0; i < allowance; i++)
        {
            Assert.True(Spend(limits, act, "alice-id"));
            clock.Advance(TimeSpan.FromMinutes(10));
        }

        using var refused = limits.Take(act, "alice-id");
        Assert.False(refused.IsGranted);
        // The first was taken at midday, and comes back a day after it.
        Assert.Equal(Midday.AddDays(1) - clock.GetUtcNow(), refused.RetryAfter);

        clock.Advance(refused.RetryAfter - TimeSpan.FromSeconds(1));
        Assert.False(Spend(limits, act, "alice-id"));

        clock.Advance(TimeSpan.FromSeconds(1));
        Assert.True(Spend(limits, act, "alice-id"));
        Assert.False(Spend(limits, act, "alice-id"));
    }

    [Fact]
    public void Take_PermitDisposedWithoutKeep_HandsItBack()
    {
        // The write it allowed was not saved — a lost race, a failure — so it was no publication.
        var limits = new RepublishLimits(new ManualClock(Midday));
        for (var i = 0; i < RepublishLimits.Allowance(Republish.NameCase) - 1; i++)
            Assert.True(Spend(limits, Republish.NameCase, "alice-id"));

        using (var unsaved = limits.Take(Republish.NameCase, "alice-id"))
            Assert.True(unsaved.IsGranted);

        Assert.True(Spend(limits, Republish.NameCase, "alice-id"));
        Assert.False(Spend(limits, Republish.NameCase, "alice-id"));
    }

    [Fact]
    public void Take_RefusedPermitDisposed_HandsNothingBack()
    {
        var limits = new RepublishLimits(new ManualClock(Midday));
        while (Spend(limits, Republish.NameCase, "alice-id")) { }

        using (var refused = limits.Take(Republish.NameCase, "alice-id"))
            Assert.False(refused.IsGranted);

        Assert.False(Spend(limits, Republish.NameCase, "alice-id"));
    }

    [Fact]
    public void Take_EachAccountAndEachAct_CountsApart()
    {
        var limits = new RepublishLimits(new ManualClock(Midday));
        while (Spend(limits, Republish.ProfilePublic, "alice-id")) { }

        Assert.True(Spend(limits, Republish.ProfilePublic, "bob-id"));
        Assert.True(Spend(limits, Republish.NameCase, "alice-id"));
    }

    [Fact]
    public void Take_AfterADayOfNothing_IsAFullAllowanceAgain()
    {
        // The sweep forgets an account whose allowance has all come back; nothing about it changes.
        var clock = new ManualClock(Midday);
        var limits = new RepublishLimits(clock);
        while (Spend(limits, Republish.NameCase, "alice-id")) { }

        clock.Advance(TimeSpan.FromDays(2));

        for (var i = 0; i < RepublishLimits.Allowance(Republish.NameCase); i++)
            Assert.True(Spend(limits, Republish.NameCase, "alice-id"));
        Assert.False(Spend(limits, Republish.NameCase, "alice-id"));
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
