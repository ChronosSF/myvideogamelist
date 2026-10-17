using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.DataProtection;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// A place in the history's order: the moment an item sorts at, its kind, and the id of the row it
/// came from.
/// </summary>
/// <remarks>
/// All three are needed, and in that order. Two items can share a moment — a run started and
/// finished on the same day sorts at one instant — so the kind breaks that tie, and the row's id
/// breaks a tie between two of a kind, as the review's id does in <see cref="ReviewCursor"/>. An
/// event is never updated, so its place never moves. A run's date or a score edited while somebody
/// reads moves its own item, which that reading may then pass over or show twice; every item whose
/// key is unchanged keeps its place, which is what an offset could not promise.
/// </remarks>
internal readonly record struct HistoryPosition(DateTimeOffset At, int Kind, long Id);

/// <summary>
/// Where one page of somebody's history ended, as the token the next request hands back.
/// </summary>
/// <remarks>
/// <para>
/// <b>A position in the order, never an offset into it</b>, for the reason ADR 0028 gives for the
/// reviews: rows move while somebody reads. A game moved in another tab adds an item at the top, and
/// an offset counted from the top would then show the reader the last item of the page they had
/// already seen.
/// </para>
/// <para>
/// <b>Encrypted</b>, with ASP.NET Data Protection, like <see cref="ReviewCursor"/> and for the same
/// two reasons. The ids it carries count rows site-wide — an event id says how many status changes
/// everybody has ever made — and nothing else hands them to the client. And protection
/// authenticates, so a cursor cannot be forged to name a place that was never a page boundary.
/// </para>
/// </remarks>
internal static class HistoryCursor
{
    /// <summary>
    /// The Data Protection purpose, isolating these tokens from every other protected payload — a
    /// review cursor does not decrypt here, nor this one there.
    /// </summary>
    public const string Purpose = "MyVideoGameList.History.Cursor.v1";

    /// <summary>
    /// The shape of a protected token, checked by the endpoint before it spends a decryption on the
    /// value. The same as <see cref="ReviewCursor.Pattern"/>, since both are Data Protection output.
    /// </summary>
    public const string Pattern = @"^[A-Za-z0-9_-]{1,512}$";

    public static string Format(IDataProtector protector, HistoryPosition position) =>
        protector.Protect(string.Create(
            CultureInfo.InvariantCulture, $"{position.At.UtcTicks}.{position.Kind}.{position.Id}"));

    /// <summary>
    /// The place a token names, or false when it is not one of ours — tampered with, protected under
    /// another purpose or key ring, or not a token at all.
    /// </summary>
    /// <remarks>
    /// The moment comes back in UTC, which is what Npgsql requires of a parameter compared with a
    /// <c>timestamp with time zone</c>.
    /// </remarks>
    public static bool TryParse(IDataProtector protector, string? token, out HistoryPosition position)
    {
        position = default;
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

        // Authenticated, so only this class wrote the payload. Parsed strictly all the same, so that
        // a changed format in a later version fails here rather than in SQL.
        var parts = payload.Split('.');
        if (parts.Length != 3
            || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var ticks)
            || ticks > DateTimeOffset.MaxValue.UtcTicks
            || !int.TryParse(parts[1], NumberStyles.None, CultureInfo.InvariantCulture, out var kind)
            || !HistoryKinds.IsKnown(kind)
            || !long.TryParse(parts[2], NumberStyles.None, CultureInfo.InvariantCulture, out var id))
        {
            return false;
        }

        position = new HistoryPosition(new DateTimeOffset(ticks, TimeSpan.Zero), kind, id);
        return true;
    }
}
