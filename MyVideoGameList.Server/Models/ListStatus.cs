namespace MyVideoGameList.Server.Models;

/// <summary>
/// The stable keys of the predefined status lists. These are written into
/// <see cref="UserGameEvent"/> rows and so are permanent — a key can be added, but renaming or
/// removing one would silently reinterpret history that has already been recorded.
/// </summary>
public static class ListStatusKeys
{
    public const string Backlog = "backlog";
    public const string Playing = "playing";
    public const string OnHold = "on_hold";
    public const string Finished = "finished";
    public const string Dropped = "dropped";
}

/// <summary>
/// One of the five predefined status lists a game can sit in. A game is in exactly one of them,
/// which is what separates a status from a custom list (many per game) or the wishlist (a
/// separate axis).
/// </summary>
/// <remarks>
/// <para>
/// System-owned: seeded by the migration, never written by a user, and never deleted from. Users
/// will be able to <em>rename</em> a status list, which writes a display name elsewhere and
/// leaves <see cref="Key"/> untouched — every statistic keys on the status, so a rename must not
/// be able to change what a list means.
/// </para>
/// <para>
/// The three flags exist so that no query has to hardcode a set of keys. <see cref="IsTerminal"/>
/// is the denominator of a completion rate and <see cref="CountsAsCompletion"/> is the numerator,
/// which is why "finished" and "dropped" cannot be told apart by terminality alone.
/// </para>
/// </remarks>
public class ListStatus
{
    public short Id { get; set; }

    /// <summary>Stable identifier, safe to use in code and in the API. Never changes.</summary>
    public required string Key { get; set; }

    /// <summary>Shown when the user has not renamed this list.</summary>
    public required string DefaultName { get; set; }

    /// <summary>Display order. Lifecycle order rather than alphabetical — the list reads as a pipeline.</summary>
    public short SortOrder { get; set; }

    /// <summary>The user has actually played the game, as opposed to merely intending to.</summary>
    public bool IsStarted { get; set; }

    /// <summary>The game is resolved one way or the other, and is no longer in flight.</summary>
    public bool IsTerminal { get; set; }

    /// <summary>Counts towards "games finished". True for "finished" only.</summary>
    public bool CountsAsCompletion { get; set; }
}
