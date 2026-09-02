namespace MyVideoGameList.Server.Models;

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
