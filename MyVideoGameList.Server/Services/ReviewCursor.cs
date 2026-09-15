using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Where one page of a game's member reviews ended, as the token the next request hands back.
/// </summary>
/// <remarks>
/// <para>
/// <b>A position in the order, not an offset into it.</b> The reviews are ordered newest first, and
/// a cursor names the last review a page held, so the next page is everything that sorts after it.
/// An offset counts rows instead, and rows move while somebody reads. Withdraw a review the reader
/// has already passed and every later one shifts up a place, so the next page starts one too far on
/// and the review that moved across the boundary is never shown. See ADR 0028.
/// </para>
/// <para>
/// <b>Both halves of the position are immutable</b>, because a cursor is only as still as the key it
/// is built on. The order is <c>CreatedAt</c>, which a rewrite does not touch, and then the review's
/// id, for two reviews written in the same instant. An earlier cut broke that tie on the author's
/// name, which a rename can move across the cursor between two requests, skipping a review or
/// showing one twice.
/// </para>
/// <para>
/// <b>The token is encrypted</b>, with ASP.NET Data Protection, because the id must not reach the
/// client: a review id counts every review ever written site-wide, private and deleted ones
/// included, which is why <c>GameReviewDto</c> leaves it out. Protection also authenticates the
/// token, so a cursor cannot be forged to name a position that was never a page boundary. The price
/// is that a cursor lives as long as the key ring — exactly what the sign-in cookie already needs,
/// so persisting the keys (ROADMAP §5) covers both.
/// </para>
/// </remarks>
internal static class ReviewCursor
{
    /// <summary>
    /// The Data Protection purpose, which isolates these tokens from every other protected payload.
    /// Changing it invalidates every cursor in flight, which is harmless: a reader's next page fails
    /// and a reload starts again.
    /// </summary>
    public const string Purpose = "MyVideoGameList.GameReviews.Cursor.v1";

    /// <summary>
    /// The shape of a protected token — base64url, and bounded — checked by the endpoint before it
    /// spends a decryption on the value. Shape is all it can check; whether the token decrypts is
    /// <see cref="TryParse"/>'s question.
    /// </summary>
    public const string Pattern = @"^[A-Za-z0-9_-]{1,512}$";

    public static string Format(IDataProtector protector, DateTimeOffset createdAt, int reviewId) =>
        protector.Protect(string.Create(CultureInfo.InvariantCulture, $"{createdAt.UtcTicks}.{reviewId}"));

    /// <summary>
    /// The review a token names, or false when it is not one of ours — tampered with, protected under
    /// another purpose or key ring, or not a token at all.
    /// </summary>
    /// <remarks>
    /// The instant comes back in UTC, which is what Npgsql requires of a parameter compared with a
    /// <c>timestamp with time zone</c> column.
    /// </remarks>
    public static bool TryParse(
        IDataProtector protector, string? token, out DateTimeOffset createdAt, out int reviewId)
    {
        createdAt = default;
        reviewId = 0;
        if (string.IsNullOrEmpty(token)) return false;

        string payload;
        try
        {
            payload = protector.Unprotect(token);
        }
        catch (CryptographicException)
        {
            return false;
        }

        // Authenticated, so only this class ever wrote the payload. Parsed as strictly as if it had
        // not been, all the same: a changed format in a later version should fail here, not in SQL.
        var dot = payload.IndexOf('.');
        if (dot <= 0
            || !long.TryParse(payload.AsSpan(0, dot), NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            || ticks > DateTimeOffset.MaxValue.UtcTicks
            || !int.TryParse(payload.AsSpan(dot + 1), NumberStyles.None, CultureInfo.InvariantCulture, out reviewId))
        {
            reviewId = 0;
            return false;
        }

        createdAt = new DateTimeOffset(ticks, TimeSpan.Zero);
        return true;
    }
}
