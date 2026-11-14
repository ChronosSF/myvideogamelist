namespace MyVideoGameList.Server.Models;

/// <summary>
/// Who can see a review.
/// </summary>
/// <remarks>
/// A string column rather than a boolean, because a third value is already foreseeable:
/// <c>friends</c>, once following exists. Adding a value to a string is additive; splitting a
/// boolean into three states is not.
/// </remarks>
public static class ReviewVisibility
{
    public const string Public = "public";
    public const string Private = "private";
}

/// <summary>
/// One user's written review of one game. At most one per game.
/// </summary>
/// <remarks>
/// <para>
/// Hung off the <see cref="UserGameEntry"/> rather than off a playthrough, because a review is
/// usually about the game rather than about one specific run through it — the optional
/// <see cref="PlaythroughId"/> is there for when it is not.
/// </para>
/// <para>
/// The <b>score is deliberately not here</b>. It lives on the entry, because a score with no prose
/// is the common case and must not require a review row to exist. That is the same reasoning
/// ADR 0019 used to put the score on the entry in the first place.
/// </para>
/// <para>
/// Writes no <see cref="UserGameEvent"/> and touches no status, exactly as a playthrough does not.
/// See <c>docs/decisions/0025-playthroughs-and-reviews.md</c>.
/// </para>
/// </remarks>
public class Review
{
    public int Id { get; set; }

    /// <summary>
    /// The owner, carried directly even though the entry already identifies them.
    /// </summary>
    /// <remarks>
    /// The ownership guard keys on this property's presence; a child reachable only through the
    /// entry would escape both the cascade and the export manifest. See
    /// <see cref="UserGamePlaythrough.UserId"/>, which carries it for the same reason.
    /// </remarks>
    public required string UserId { get; set; }

    /// <summary>Unique: one review per user per game.</summary>
    public int UserGameEntryId { get; set; }

    public required string Body { get; set; }

    /// <summary>Whether the body gives away something a reader may not want spoiled.</summary>
    public bool HasSpoilers { get; set; }

    /// <summary>One of <see cref="ReviewVisibility"/>.</summary>
    public required string Visibility { get; set; }

    /// <summary>
    /// The playthrough this review is about, when the user said which. Cleared rather than
    /// cascaded when that playthrough is deleted — losing a run's record must not take the prose
    /// written about it.
    /// </summary>
    public int? PlaythroughId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>
    /// When an admin hid the review from every reader but its author, on a report, or null when it is
    /// not hidden.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A third gate beside <see cref="Visibility"/> and the profile's, and the narrowest wins: a hidden
    /// review is published nowhere and counted nowhere, whatever its author chose. Its author still reads,
    /// edits and deletes it, and an edit does not bring it back; an admin does, by clearing this.
    /// </para>
    /// <para>
    /// When, never who: an admin page records no account on what it changes (ADR 0042). Hidden rather
    /// than deleted, because the words are the author's and an admin withdraws their publication, never
    /// the words themselves. See <c>docs/decisions/0076-*</c>.
    /// </para>
    /// </remarks>
    public DateTimeOffset? HiddenAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public UserGameEntry Entry { get; set; } = null!;
    public UserGamePlaythrough? Playthrough { get; set; }
}
