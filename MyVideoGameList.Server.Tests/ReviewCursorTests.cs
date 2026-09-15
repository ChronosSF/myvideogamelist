using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.DataProtection;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The encrypted cursor that pages a game's member reviews.
/// </summary>
/// <remarks>
/// Two promises are pinned here. Every token the service writes passes the endpoint's shape check —
/// the real <see cref="RegularExpressionAttribute"/> over the same <see cref="ReviewCursor.Pattern"/>
/// the controller declares — so a drift fails here rather than as a 400 on somebody's second page.
/// And nothing but a token this key ring issued, under this purpose, ever reads as a position.
/// </remarks>
public class ReviewCursorTests
{
    private static readonly RegularExpressionAttribute EndpointValidation = new(ReviewCursor.Pattern);

    private static IDataProtector Protector(IDataProtectionProvider? keys = null) =>
        (keys ?? new EphemeralDataProtectionProvider()).CreateProtector(ReviewCursor.Purpose);

    [Fact]
    public void Format_ThenTryParse_RoundTripsTheInstantAndTheId()
    {
        var protector = Protector();
        var writtenAt = new DateTimeOffset(2026, 9, 14, 8, 32, 22, TimeSpan.Zero).AddTicks(7_897_780);

        var token = ReviewCursor.Format(protector, writtenAt, 42);

        Assert.True(ReviewCursor.TryParse(protector, token, out var createdAt, out var reviewId));
        Assert.Equal(writtenAt.UtcTicks, createdAt.UtcTicks);
        Assert.Equal(42, reviewId);
    }

    [Fact]
    public void TryParse_ReturnsTheInstantInUtc()
    {
        // Npgsql refuses a DateTimeOffset parameter with any other offset when it is compared with a
        // timestamptz column, so a cursor written from a non-UTC value must still come back as UTC.
        var protector = Protector();
        var token = ReviewCursor.Format(protector, new DateTimeOffset(2026, 9, 14, 11, 0, 0, TimeSpan.FromHours(3)), 1);

        Assert.True(ReviewCursor.TryParse(protector, token, out var createdAt, out _));
        Assert.Equal(TimeSpan.Zero, createdAt.Offset);
        Assert.Equal(new DateTimeOffset(2026, 9, 14, 8, 0, 0, TimeSpan.Zero), createdAt);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(987_654)]
    [InlineData(int.MaxValue)]
    public void Format_AlwaysPassesTheEndpointsShapeCheck(int reviewId)
    {
        var protector = Protector();
        DateTimeOffset[] instants =
        [
            DateTimeOffset.UnixEpoch,
            new(2026, 9, 14, 0, 0, 0, TimeSpan.Zero),
            DateTimeOffset.MaxValue
        ];

        foreach (var at in instants)
        {
            var token = ReviewCursor.Format(protector, at, reviewId);

            Assert.True(EndpointValidation.IsValid(token), token);
            Assert.True(ReviewCursor.TryParse(protector, token, out _, out _), token);
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("not-a-cursor")]
    [InlineData("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")]
    [InlineData("638930000000000000.42")]
    public void TryParse_RefusesWhatThisRingNeverIssued(string? token)
    {
        // Including a position written out in the clear: shaped like the payload, never encrypted.
        Assert.False(ReviewCursor.TryParse(Protector(), token, out _, out _));
    }

    [Fact]
    public void TryParse_RefusesATamperedToken()
    {
        // Authenticated as well as encrypted, so a reader cannot nudge a cursor to a position that
        // was never a page boundary.
        var protector = Protector();
        var token = ReviewCursor.Format(protector, DateTimeOffset.UnixEpoch.AddYears(56), 42);
        var middle = token.Length / 2;
        var tampered = token[..middle] + (token[middle] == 'A' ? 'B' : 'A') + token[(middle + 1)..];

        Assert.False(ReviewCursor.TryParse(protector, tampered, out _, out _));
    }

    [Fact]
    public void TryParse_RefusesATokenFromAnotherKeyRingOrPurpose()
    {
        var keys = new EphemeralDataProtectionProvider();
        var at = new DateTimeOffset(2026, 9, 14, 0, 0, 0, TimeSpan.Zero);

        var fromAnotherRing = ReviewCursor.Format(Protector(), at, 42);
        var fromAnotherPurpose = keys.CreateProtector("Something.Else").Protect($"{at.UtcTicks}.42");

        Assert.False(ReviewCursor.TryParse(Protector(keys), fromAnotherRing, out _, out _));
        Assert.False(ReviewCursor.TryParse(Protector(keys), fromAnotherPurpose, out _, out _));
    }

    [Theory]
    [InlineData("hello")]
    [InlineData("42")]
    [InlineData(".42")]
    [InlineData("638930000000000000.")]
    [InlineData("638930000000000000.-1")]
    [InlineData("99999999999999999999.42")]
    public void TryParse_RefusesAnAuthenticPayloadInTheWrongShape(string payload)
    {
        // Only this class writes under the purpose, so these cannot arrive today. Parsed strictly all
        // the same, so a format changed in a later version fails here rather than in SQL.
        var protector = Protector();

        Assert.False(ReviewCursor.TryParse(protector, protector.Protect(payload), out _, out _));
    }
}
