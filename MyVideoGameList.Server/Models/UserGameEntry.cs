namespace MyVideoGameList.Server.Models;

/// <summary>
/// How the user has the game right now. Stored as <see cref="UserGameEntry.Ownership"/>.
/// </summary>
/// <remarks>
/// <para>
/// A string rather than an enum column, for the reason <see cref="ReviewVisibility"/> gives: a
/// fourth value — rented, a free weekend, a family share — is one additive migration to the check
/// constraint, where renumbering an enum is not. The keys are permanent once written, because the
/// export carries them.
/// </para>
/// <para>
/// Deliberately not a storefront or a platform. Where somebody played is on the playthrough (ADR
/// 0025); this answers only whether the copy is theirs to keep.
/// </para>
/// </remarks>
public static class OwnershipKinds
{
    /// <summary>Bought, physically or digitally — theirs to keep.</summary>
    public const string Owned = "owned";

    /// <summary>Playable through a subscription such as Game Pass, and gone when it lapses.</summary>
    public const string Subscription = "subscription";

    /// <summary>Somebody else's copy — a friend's, a library's.</summary>
    public const string Borrowed = "borrowed";
}

/// <summary>
/// Everything one user has recorded about one game. Their score, when they added it, and — as one
/// field among several — which status list it currently sits in.
/// </summary>
/// <remarks>
/// <para>
/// This is deliberately <em>not</em> a list-membership row. A score is a judgement about a game
/// and has nothing to do with where the game sits in someone's lists, so taking a game out of
/// every list clears <see cref="StatusId"/> and leaves the rest of the row alone. That is why
/// <see cref="StatusId"/> is nullable: an entry with no status is a game the user has data about
/// but is not currently tracking.
/// </para>
/// <para>
/// Deleting the whole row is a separate, explicit act — "delete everything I have recorded about
/// this game" — and never a side effect of reorganising lists.
/// </para>
/// <para>
/// Current state only. The history of how the status got here lives in
/// <see cref="UserGameEvent"/>, because these fields are overwritten in place.
/// </para>
/// </remarks>
public class UserGameEntry
{
    /// <summary>
    /// Surrogate key. Uniqueness is still <c>(UserId, GameId)</c>, enforced by a unique index —
    /// this exists so that playthroughs, reviews and tags can point at one column instead of
    /// carrying both of those in their own key and in every join.
    /// </summary>
    public int Id { get; set; }

    public required string UserId { get; set; }

    /// <summary>IGDB game ID.</summary>
    public int GameId { get; set; }

    /// <summary>
    /// One of the five predefined statuses, or null when the game is in none of the user's lists.
    /// See <see cref="ListStatus"/>.
    /// </summary>
    public short? StatusId { get; set; }

    /// <summary>
    /// The user's own score out of 10, independent of <see cref="StatusId"/> — a game can be
    /// scored while Dropped, which is often the most informative score there is.
    /// </summary>
    public short? Score { get; set; }

    /// <summary>
    /// One of <see cref="OwnershipKinds"/>, or null when the user has not said. Current state, like
    /// the status: a game bought after a subscription lapsed is overwritten, not appended.
    /// </summary>
    public string? Ownership { get; set; }

    /// <summary>
    /// The user's own notes about the game as a whole — where a save file lives, what to do first
    /// next time. Private: never on a profile, never in a community view.
    /// </summary>
    /// <remarks>
    /// Not the playthrough's notes, which are about one run, and not a review, which is written to
    /// be read by other people and carries a visibility for that reason. See ADR 0030.
    /// </remarks>
    public string? Notes { get; set; }

    /// <summary>When the user first recorded anything about this game. Never updated afterwards.</summary>
    public DateTimeOffset AddedAt { get; set; }

    /// <summary>
    /// When <see cref="StatusId"/> last changed, including to null. The sort key behind
    /// "recently moved"; null for entries that have never been in a list.
    /// </summary>
    public DateTimeOffset? StatusChangedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public ListStatus? Status { get; set; }
}
