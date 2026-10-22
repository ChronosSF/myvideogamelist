using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// When an account's last-seen date is written again: once a UTC day, and never more (ADR 0051).
/// </summary>
public class AccountActivityTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 13, 9, 30, 0, TimeSpan.Zero);

    [Fact]
    public void IsNewDay_NeverSeen_IsTrue() =>
        Assert.True(AccountActivity.IsNewDay(null, Now));

    [Fact]
    public void IsNewDay_SeenEarlierTheSameUtcDay_IsFalse() =>
        Assert.False(AccountActivity.IsNewDay(new DateTimeOffset(2026, 10, 13, 0, 1, 0, TimeSpan.Zero), Now));

    [Fact]
    public void IsNewDay_SeenOnAnEarlierUtcDay_IsTrue() =>
        Assert.True(AccountActivity.IsNewDay(new DateTimeOffset(2026, 10, 12, 23, 59, 0, TimeSpan.Zero), Now));

    [Fact]
    public void IsNewDay_ComparesUtcDates_WhateverOffsetEitherWasTakenIn()
    {
        // 01:00 in UTC+3 on the 13th is still the 12th in UTC; 02:00 in UTC+3 on the 14th is the 13th.
        var lateOnTheTwelfthUtc = new DateTimeOffset(2026, 10, 13, 1, 0, 0, TimeSpan.FromHours(3));
        var lateOnTheThirteenthUtc = new DateTimeOffset(2026, 10, 14, 2, 0, 0, TimeSpan.FromHours(3));

        Assert.True(AccountActivity.IsNewDay(lateOnTheTwelfthUtc, Now));
        Assert.False(AccountActivity.IsNewDay(lateOnTheThirteenthUtc, Now));
    }
}
