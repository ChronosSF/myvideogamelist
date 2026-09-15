using System.Globalization;
using System.Text.RegularExpressions;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Where one page of a game's member reviews ended, as the token the next request hands back.
/// </summary>
/// <remarks>
/// <para>
/// <b>A position in the order, not an offset into it.</b> The reviews are ordered by when they were
/// written, newest first, and a cursor names the last review a page held, so the next page is
/// everything written before it. An offset counts rows instead, and rows move while somebody reads.
/// Withdraw a review the reader has already passed and every later one shifts up a place, so the next
/// page starts one too far on and the review that moved across the boundary is never shown. See
/// ADR 0028.
/// </para>
/// <para>
/// The position is the review's <c>CreatedAt</c>, which never changes — ordering by when a review was
/// last rewritten would let an unread one jump above the cursor and be skipped the same way — with
/// the author's name to break a tie between two reviews written in the same instant. That is the name
/// the page already shows, so the token publishes nothing the response does not. The review's own id
/// would have: it says how many reviews exist site-wide, private ones included.
/// </para>
/// <para>
/// Every token that matches <see cref="Pattern"/> parses, which is what lets the endpoint validate it
/// with an attribute and nothing more. Eighteen digits of ticks reach the year 3169, and every tick
/// count below that is a valid date; the digits are spelled <c>[0-9]</c> because <c>\d</c> would
/// also admit digits from other scripts, which <see cref="long.Parse(string, IFormatProvider)"/>
/// then refuses.
/// </para>
/// <para>
/// The name part is deliberately not held to the username alphabet. The cursor carries a name to
/// compare against, as a query parameter, not to vouch for — and the alphabet is stated once, in
/// <see cref="Models.UserNamePolicy"/>, so that nothing can come to disagree with it.
/// </para>
/// </remarks>
internal static partial class ReviewCursor
{
    /// <summary>
    /// <c>{ticks}.{userName}</c>, the name up to the length Identity's column allows. The first dot
    /// is the separator, since ticks have none.
    /// </summary>
    public const string Pattern = @"^[0-9]{1,18}\..{1,256}$";

    public static string Format(DateTimeOffset createdAt, string userName) =>
        string.Create(CultureInfo.InvariantCulture, $"{createdAt.UtcTicks}.{userName}");

    /// <summary>
    /// The review a token names, or false when it is not a token at all.
    /// </summary>
    /// <remarks>
    /// The instant comes back in UTC, which is what Npgsql requires of a parameter compared with a
    /// <c>timestamp with time zone</c> column.
    /// </remarks>
    public static bool TryParse(string? token, out DateTimeOffset createdAt, out string userName)
    {
        createdAt = default;
        userName = "";

        // A full match, as RegularExpressionAttribute demands, so the two cannot disagree about a
        // trailing newline that `$` alone would let through.
        if (token is null || Shape().Match(token) is not { Success: true } match || match.Length != token.Length)
            return false;

        var dot = token.IndexOf('.');
        createdAt = new DateTimeOffset(long.Parse(token[..dot], CultureInfo.InvariantCulture), TimeSpan.Zero);
        userName = token[(dot + 1)..];
        return true;
    }

    [GeneratedRegex(Pattern, RegexOptions.None, matchTimeoutMilliseconds: 200)]
    private static partial Regex Shape();
}
