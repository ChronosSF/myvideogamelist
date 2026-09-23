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
/// What put the entry here. Stored as <see cref="UserGameEntry.Origin"/>.
/// </summary>
/// <remarks>
/// <para>
/// ADR 0026 required this so that "an import writes no <see cref="UserGameEvent"/>" is checkable
/// rather than folklore. Without it the only trace of an imported row is an <em>absent</em> event,
/// which is indistinguishable from a bug that dropped one — so the rule reads: a status has an
/// event behind it unless its entry's origin is not <see cref="Manual"/>.
/// </para>
/// <para>
/// The value names the <em>source</em>, not the act. "grouvee" rather than "import", because
/// "undo my Grouvee import" is then a query, and because a row whose shape looks odd years from now
/// says which importer produced it. Every preset adds a value; see ADR 0037.
/// </para>
/// <para>
/// Unlike <see cref="OwnershipKinds"/> and <c>ReviewVisibility</c>, this deliberately has
/// <b>no check constraint</b>. Those two enumerate closed sets. This one is open by construction —
/// the whole point of the preset design is that a new source is data rather than code, and a check
/// constraint would make each one a migration. Its absence here is a decision, not an oversight.
/// </para>
/// </remarks>
public static class EntryOrigins
{
    /// <summary>The user did this themselves, in the app. The default, and almost every row.</summary>
    public const string Manual = "manual";

    /// <summary>Imported from a Grouvee export (ADR 0037).</summary>
    public const string Grouvee = "grouvee";
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

    /// <summary>
    /// One of <see cref="EntryOrigins"/> — what put this row here. Defaults to
    /// <see cref="EntryOrigins.Manual"/> in the database as well as here, so a row written by
    /// anything that is not this application carries the honest value too.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Precisely: <b>what last wrote a status here without recording an event</b>. So
    /// <see cref="EntryOrigins.Manual"/> means every status this entry has held has a
    /// <see cref="UserGameEvent"/> behind it, and anything else means it may not.
    /// </para>
    /// <para>
    /// Set by an import whether it creates the entry or writes over one somebody made by hand —
    /// the eventless status is the thing being marked, not the row's parentage. Never cleared,
    /// including by a later manual move, which errs towards distrusting a status that is in fact
    /// accounted for. That direction is the safe one: a false negative costs an auditor a lookup,
    /// where a false positive would hide exactly the row the column exists to flag.
    /// </para>
    /// </remarks>
    public string Origin { get; set; } = EntryOrigins.Manual;

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
