using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.DataProtection;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The encrypted cursor that pages the owner's history.
/// </summary>
/// <remarks>
/// The same two promises <see cref="ReviewCursorTests"/> pins for the reviews: every token written
/// passes the endpoint's own shape check, and nothing but a token this ring issued under this purpose
/// reads as a place in the order.
/// </remarks>
public class HistoryCursorTests
{
    private static readonly RegularExpressionAttribute EndpointValidation = new(HistoryCursor.Pattern);

    private static IDataProtector Protector(IDataProtectionProvider? keys = null) =>
        (keys ?? new EphemeralDataProtectionProvider()).CreateProtector(HistoryCursor.Purpose);

    [Fact]
    public void Format_ThenTryParse_RoundTripsTheMomentTheKindAndTheId()
    {
        var protector = Protector();
        var at = new DateTimeOffset(2026, 10, 17, 8, 32, 22, TimeSpan.Zero).AddTicks(7_897_780);
        var written = new HistoryPosition(at, HistoryKinds.Score, 5_000_000_000);

        var token = HistoryCursor.Format(protector, written);

        Assert.True(HistoryCursor.TryParse(protector, token, out var read));
        Assert.Equal(written.At.UtcTicks, read.At.UtcTicks);
        Assert.Equal(written.Kind, read.Kind);
        Assert.Equal(written.Id, read.Id);
    }

    [Fact]
    public void TryParse_ReturnsTheMomentInUtc()
    {
        // Npgsql refuses a DateTimeOffset parameter with any other offset beside a timestamptz.
        var protector = Protector();
        var token = HistoryCursor.Format(protector,
            new HistoryPosition(new DateTimeOffset(2026, 10, 17, 11, 0, 0, TimeSpan.FromHours(3)), HistoryKinds.Status, 1));

        Assert.True(HistoryCursor.TryParse(protector, token, out var read));
        Assert.Equal(TimeSpan.Zero, read.At.Offset);
        Assert.Equal(new DateTimeOffset(2026, 10, 17, 8, 0, 0, TimeSpan.Zero), read.At);
    }

    [Theory]
    [InlineData(HistoryKinds.PlaythroughStarted, 1L)]
    [InlineData(HistoryKinds.PlaythroughFinished, 987_654L)]
    [InlineData(HistoryKinds.Status, long.MaxValue)]
    [InlineData(HistoryKinds.Score, int.MaxValue)]
    public void Format_AlwaysPassesTheEndpointsShapeCheck(int kind, long id)
    {
        var protector = Protector();
        DateTimeOffset[] instants = [DateTimeOffset.UnixEpoch, new(2026, 10, 17, 12, 0, 0, TimeSpan.Zero), DateTimeOffset.MaxValue];

        foreach (var at in instants)
        {
            var token = HistoryCursor.Format(protector, new HistoryPosition(at, kind, id));

            Assert.True(EndpointValidation.IsValid(token), token);
            Assert.True(HistoryCursor.TryParse(protector, token, out _), token);
        }
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("not-a-cursor")]
    [InlineData("638930000000000000.3.42")]
    public void TryParse_RefusesWhatThisRingNeverIssued(string? token)
    {
        // Including a position written out in the clear: shaped like the payload, never encrypted.
        Assert.False(HistoryCursor.TryParse(Protector(), token, out _));
    }

    [Fact]
    public void TryParse_RefusesATamperedToken()
    {
        var protector = Protector();
        var token = HistoryCursor.Format(protector, new HistoryPosition(DateTimeOffset.UnixEpoch.AddYears(56), HistoryKinds.Status, 42));
        var middle = token.Length / 2;
        var tampered = token[..middle] + (token[middle] == 'A' ? 'B' : 'A') + token[(middle + 1)..];

        Assert.False(HistoryCursor.TryParse(protector, tampered, out _));
    }

    [Fact]
    public void TryParse_RefusesATokenFromAnotherKeyRingOrPurpose()
    {
        // A review cursor is the likeliest stray: the same ring, a different purpose.
        var keys = new EphemeralDataProtectionProvider();
        var at = new DateTimeOffset(2026, 10, 17, 0, 0, 0, TimeSpan.Zero);

        var fromAnotherRing = HistoryCursor.Format(Protector(), new HistoryPosition(at, HistoryKinds.Status, 42));
        var aReviewCursor = ReviewCursor.Format(keys.CreateProtector(ReviewCursor.Purpose), at, 42);

        Assert.False(HistoryCursor.TryParse(Protector(keys), fromAnotherRing, out _));
        Assert.False(HistoryCursor.TryParse(Protector(keys), aReviewCursor, out _));
    }

    [Theory]
    [InlineData("hello")]
    [InlineData("638930000000000000.42")]
    [InlineData("638930000000000000.3")]
    [InlineData("638930000000000000.3.42.1")]
    [InlineData(".3.42")]
    [InlineData("638930000000000000..42")]
    [InlineData("638930000000000000.0.42")]
    [InlineData("638930000000000000.5.42")]
    [InlineData("638930000000000000.3.-1")]
    [InlineData("99999999999999999999.3.42")]
    [InlineData("3155378976000000000.3.42")]
    public void TryParse_RefusesAnAuthenticPayloadInTheWrongShape(string payload)
    {
        // Only this class writes under the purpose, so none of these can arrive today — a review
        // cursor's two-part payload, an unknown kind among them, and an instant one tick past the
        // last a DateTimeOffset can hold, which would otherwise throw from its constructor. Parsed
        // strictly all the same, so a format changed in a later version fails here, not in SQL.
        var protector = Protector();

        Assert.False(HistoryCursor.TryParse(protector, protector.Protect(payload), out _));
    }
}
