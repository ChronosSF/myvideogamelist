using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The cursor that pages a game's member reviews, and the one promise the endpoint relies on: every
/// token its validation attribute admits is one the service can read, and every token the service
/// writes is one the attribute admits.
/// </summary>
/// <remarks>
/// The attribute here is the real <see cref="RegularExpressionAttribute"/> over the same
/// <see cref="ReviewCursor.Pattern"/> the controller declares, so a drift between the two halves
/// fails here rather than as a 400 on somebody's second page, or a 500 on a typed URL.
/// </remarks>
public class ReviewCursorTests
{
    private static readonly RegularExpressionAttribute EndpointValidation = new(ReviewCursor.Pattern);

    [Fact]
    public void Format_ThenTryParse_RoundTripsTheInstantAndTheName()
    {
        var writtenAt = new DateTimeOffset(2026, 9, 14, 8, 32, 22, TimeSpan.Zero).AddTicks(7_897_780);

        var token = ReviewCursor.Format(writtenAt, "alice14188");

        Assert.True(ReviewCursor.TryParse(token, out var createdAt, out var userName));
        Assert.Equal(writtenAt, createdAt);
        Assert.Equal(writtenAt.UtcTicks, createdAt.UtcTicks);
        Assert.Equal("alice14188", userName);
    }

    [Fact]
    public void TryParse_ReturnsTheInstantInUtc()
    {
        // Npgsql refuses a DateTimeOffset parameter with any other offset when it is compared with a
        // timestamptz column, so a cursor written from a non-UTC value must still come back as UTC.
        var token = ReviewCursor.Format(new DateTimeOffset(2026, 9, 14, 11, 0, 0, TimeSpan.FromHours(3)), "sam");

        Assert.True(ReviewCursor.TryParse(token, out var createdAt, out _));
        Assert.Equal(TimeSpan.Zero, createdAt.Offset);
        Assert.Equal(new DateTimeOffset(2026, 9, 14, 8, 0, 0, TimeSpan.Zero), createdAt);
    }

    [Theory]
    [InlineData("alex")]
    [InlineData("Sam_2")]
    [InlineData("ABCDEFGHIJKLMNOPQRST")]
    public void Format_AlwaysPassesTheEndpointsValidation(string userName)
    {
        // Names of every shape the username policy allows, from the epoch to well past any review.
        Assert.Equal(UserNamePolicy.Result.Ok, UserNamePolicy.Check(userName));

        DateTimeOffset[] instants =
        [
            DateTimeOffset.UnixEpoch,
            new(2026, 9, 14, 0, 0, 0, TimeSpan.Zero),
            new(3000, 1, 1, 0, 0, 0, TimeSpan.Zero)
        ];

        foreach (var at in instants)
        {
            var token = ReviewCursor.Format(at, userName);

            Assert.True(EndpointValidation.IsValid(token), token);
            Assert.True(ReviewCursor.TryParse(token, out _, out _), token);
        }
    }

    [Fact]
    public void TryParse_TakesTheFirstDotAsTheSeparator()
    {
        // Ticks never contain one, so a dot in the name part is part of the name.
        Assert.True(ReviewCursor.TryParse("638930000000000000.a.b", out _, out var userName));
        Assert.Equal("a.b", userName);
    }

    [Theory]
    [InlineData("alex")]
    [InlineData("638930000000000000")]
    [InlineData("638930000000000000.")]
    [InlineData(".alex")]
    [InlineData("638930000000000000.alex\n")]
    [InlineData("-638930000000000000.alex")]
    [InlineData("1234567890123456789.alex")]
    [InlineData("١٢٣.alex")]
    public void Malformed_IsRefusedByBothTheEndpointAndTheParser(string token)
    {
        // The last two are the ones a looser pattern would admit and the parser would then choke
        // on: nineteen digits can overflow a tick count, and `\d` also matches Arabic-Indic digits.
        Assert.False(EndpointValidation.IsValid(token));
        Assert.False(ReviewCursor.TryParse(token, out _, out _));
    }
}
