namespace MyVideoGameList.Server.Models;

/// <summary>
/// One time through a game: how it was played, on what, for how long, and when.
/// </summary>
/// <remarks>
/// <para>
/// One row per playthrough rather than a set of columns on <see cref="UserGameEntry"/>. Replaying
/// a game on a different platform is a second row, not an overwrite, which is the whole reason
/// playtime and platform were kept off the entry.
/// </para>
/// <para>
/// A playthrough is <em>not</em> a status transition and writes no <see cref="UserGameEvent"/>.
/// The two logs answer different questions and diverge in a real case: replaying a game already
/// marked Finished adds a playthrough with no transition at all. Nothing here may change
/// <see cref="UserGameEntry.StatusId"/> either — that goes through <c>ListService</c> and nowhere
/// else (ADR 0018).
/// </para>
/// <para>
/// Almost every field is nullable on purpose. A playthrough logged the day someone starts a game
/// has a platform and a start date and nothing else; the type and the hours arrive when it ends,
/// if they ever do. Only typed playthroughs carrying minutes feed the community median, so an
/// incomplete row costs nothing but is still worth keeping.
/// </para>
/// </remarks>
public class UserGamePlaythrough
{
    public int Id { get; set; }

    /// <summary>
    /// The owner, carried directly even though the entry already identifies them.
    /// </summary>
    /// <remarks>
    /// The ownership guard (<c>UserOwnedDataTests</c>, ADR 0024) selects user-owned entities by
    /// the presence of a <c>UserId</c> property and then demands a cascading foreign key tied to
    /// it. A child keyed only through the entry would carry no such column and so would escape
    /// both halves of that contract — the cascade assertion and the export manifest — silently.
    /// </remarks>
    public required string UserId { get; set; }

    /// <summary>The entry this playthrough belongs to. Consistency with <see cref="UserId"/> is a
    /// composite foreign key rather than a convention; see <c>ApplicationDbContext</c>.</summary>
    public int UserGameEntryId { get; set; }

    /// <summary>
    /// One of the seeded <see cref="PlaythroughType"/> rows, or null while the user does not yet
    /// know — a run still in progress has no answer to "how thoroughly".
    /// </summary>
    public short? TypeId { get; set; }

    /// <summary>
    /// IGDB platform id, with no foreign key and no validation against IGDB. A write must never
    /// depend on a third party being reachable, so an id we cannot resolve is stored and resolved
    /// to a name at read time, on the client.
    /// </summary>
    public int? PlatformId { get; set; }

    /// <summary>
    /// Minutes played, as the user reports them. Stored in minutes rather than hours because
    /// "3h 40m" is a thing people type; every display rounds it.
    /// </summary>
    public int? MinutesPlayed { get; set; }

    /// <summary>Calendar dates, not timestamps: nobody records the hour they started a game.</summary>
    public DateOnly? StartedOn { get; set; }

    /// <summary>Null while the run is unfinished. Never earlier than <see cref="StartedOn"/>.</summary>
    public DateOnly? FinishedOn { get; set; }

    public string? Notes { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public UserGameEntry Entry { get; set; } = null!;
    public PlaythroughType? Type { get; set; }
}
