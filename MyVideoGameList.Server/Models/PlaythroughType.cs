namespace MyVideoGameList.Server.Models;

/// <summary>
/// The stable keys of the three playthrough types.
/// </summary>
/// <remarks>
/// <para>
/// Permanent, for the same reason <see cref="ListStatusKeys"/> is: a key is what the API, the
/// export document and every aggregate over the community medians are written against. Adding a
/// fourth type is additive; renaming or removing one would silently reinterpret playthroughs
/// somebody has already recorded.
/// </para>
/// <para>
/// The three deliberately mirror IGDB's <c>hastily</c> / <c>normally</c> / <c>completely</c>
/// tiers, so the game page can show our medians against IGDB's averages as two readable rows
/// rather than one blend of unclear provenance. The names here are <em>ours</em>, though — the
/// mapping between the two vocabularies lives in exactly one place on the client, and IGDB's
/// spellings are deliberately not stored in our database.
/// </para>
/// </remarks>
public static class PlaythroughTypeKeys
{
    public const string Rushed = "rushed";
    public const string Normally = "normally";
    public const string Completionist = "completionist";
}

/// <summary>
/// How thoroughly a game was played: straight through, at a normal pace, or exhaustively.
/// </summary>
/// <remarks>
/// System-owned lookup, shaped exactly like <see cref="ListStatus"/>: seeded by the migration,
/// never written by a user, and never deleted from. A playthrough may carry no type at all — that
/// is what "still playing, do not know yet" looks like — so nothing here is required.
/// </remarks>
public class PlaythroughType
{
    public short Id { get; set; }

    /// <summary>Stable identifier, safe to use in code and in the API. Never changes.</summary>
    public required string Key { get; set; }

    /// <summary>Shown when nothing has renamed this type. Renaming is not a feature yet.</summary>
    public required string DefaultName { get; set; }

    /// <summary>Display order: increasing effort, matching the order IGDB reports its tiers in.</summary>
    public short SortOrder { get; set; }
}
