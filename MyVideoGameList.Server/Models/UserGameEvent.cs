namespace MyVideoGameList.Server.Models;

/// <summary>
/// One status transition for one game, appended when it happens and never updated.
/// </summary>
/// <remarks>
/// <para>
/// This table exists because <see cref="UserGameEntry"/> only holds current state. Moving a game
/// from Playing to Finished overwrites the row, so without this log the fact that it ever happened
/// is never written anywhere and no later migration can recover it. Every other gap in the schema
/// is a migration away; this one is data you do not get back.
/// </para>
/// <para>
/// Deliberately <b>not</b> keyed to <see cref="UserGameEntry"/>. The entry survives a game leaving
/// every list, but it does not survive "delete everything about this game" — and that deletion
/// must not take the history with it, so this row holds no key to the entry.
/// </para>
/// <para>
/// Status transitions only. Custom-list membership is a different relation (many per game, no
/// "from" endpoint) and belongs nowhere near this table; the activity feed unions the two at read
/// time instead. See <c>docs/data-model-plan.md</c>.
/// </para>
/// </remarks>
public class UserGameEvent
{
    public long Id { get; set; }

    public required string UserId { get; set; }

    /// <summary>IGDB game ID, with no foreign key — IGDB is the source of truth for games.</summary>
    public int GameId { get; set; }

    /// <summary>The status left behind. Null when the game was in no list before this.</summary>
    public short? FromStatusId { get; set; }

    /// <summary>
    /// The status arrived at. Null when the game left every list — which is a status change, not a
    /// deletion: the entry and its score stay behind.
    /// </summary>
    public short? ToStatusId { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public ListStatus? FromStatus { get; set; }
    public ListStatus? ToStatus { get; set; }
}
