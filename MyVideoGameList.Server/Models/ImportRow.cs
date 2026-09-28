namespace MyVideoGameList.Server.Models;

/// <summary>
/// How confidently a row was resolved to an IGDB game.
/// </summary>
/// <remarks>
/// Only <see cref="Matched"/> is ever pre-checked on the review screen, which is the whole reason
/// there are three of these rather than a number: the other two are both "somebody has to look at
/// this", and telling them apart is what decides whether the screen offers a choice or asks for a
/// search. See <c>ImportMatching</c>.
/// </remarks>
public static class ImportMatchKinds
{
    /// <summary>
    /// The source named no game and no matching pass has looked for one yet.
    /// </summary>
    /// <remarks>
    /// <b>Distinct from <see cref="Unmatched"/>, and that distinction is what makes matching
    /// resumable.</b> One means nobody has asked, the other means somebody asked and IGDB had no
    /// answer. Collapse them and a row the matcher could not place is indistinguishable from one it
    /// has never seen, so every pass spends its whole budget re-asking the same unanswerable
    /// questions instead of reaching the rows behind them. It is a state of the row, so it lives in
    /// the column that holds the row's state rather than being inferred from a null elsewhere.
    /// </remarks>
    public const string Unlooked = "unlooked";

    /// <summary>
    /// The source named an IGDB game and we have it, or the matcher found exactly one answer it
    /// could not be wrong about.
    /// </summary>
    public const string Matched = "matched";

    /// <summary>
    /// The matcher found games worth offering but no single answer — several titles identical, a
    /// near miss, or years that disagree. <c>ImportRow.Candidates</c> holds them, and the row is
    /// not imported until its owner picks one (<c>specs/csv-list-import.md</c> §M3).
    /// </summary>
    public const string Ambiguous = "ambiguous";

    /// <summary>
    /// A matching pass looked and found nothing worth offering — or the source named an id IGDB no
    /// longer knows. Never imported without the user choosing a game for it, and carried into the
    /// failure report if they do not.
    /// </summary>
    public const string Unmatched = "unmatched";
}

/// <summary>
/// What the user decided about a row on the review screen.
/// </summary>
public static class ImportDecisions
{
    /// <summary>Write this row. The default for a matched row with nothing already in its way.</summary>
    public const string Import = "import";

    /// <summary>
    /// Leave this row alone. The default for an unmatched row, and for one whose game the user
    /// already has an entry for — an import must not overwrite what somebody has already recorded
    /// unless they say so per row (<c>specs/csv-list-import.md</c> §S8).
    /// </summary>
    public const string Skip = "skip";
}

/// <summary>
/// One game from an uploaded file, in the shape every preset reduces to.
/// </summary>
/// <remarks>
/// <para>
/// The canonical values live in <see cref="Payload"/> as a JSON document rather than in a column
/// each, for the reason <see cref="CachedGame.Payload"/> does: a row carries a <em>variable number
/// of playthroughs</em>, so columns would need a third table for data that is only ever read back
/// whole, at commit, by the code that wrote it. The columns beside it are extracted copies of the
/// few fields something actually queries or orders by.
/// </para>
/// <para>
/// Whether the game is already in the user's lists is <b>not</b> stored. It is a fact about their
/// library rather than about this file, and it can change between the upload and the commit — so it
/// is read fresh whenever the review is served, and again when the commit runs.
/// </para>
/// </remarks>
public class ImportRow
{
    public int Id { get; set; }

    /// <summary>
    /// The owner, carried directly even though the job already identifies them.
    /// </summary>
    /// <remarks>
    /// The ownership guard (<c>UserOwnedDataTests</c>, ADR 0024) selects user-owned entities by the
    /// presence of a <c>UserId</c> property and then demands a cascading foreign key tied to it. A
    /// child keyed only through its parent would carry no such column and escape both halves of the
    /// contract silently — the same reasoning that puts one on a playthrough and on a review
    /// (ADR 0025).
    /// </remarks>
    public required string UserId { get; set; }

    /// <summary>
    /// The job this row belongs to. Consistency with <see cref="UserId"/> is a composite foreign
    /// key rather than a convention; see <c>ApplicationDbContext</c>.
    /// </summary>
    public Guid ImportJobId { get; set; }

    /// <summary>
    /// The source's own identifier for this row, when it has one — Grouvee's game id. Kept so that
    /// a row can be traced back to the file it came from while diagnosing a bad import.
    /// </summary>
    public string? SourceRef { get; set; }

    /// <summary>
    /// The title as the source spelled it. Extracted from <see cref="Payload"/> so the review
    /// screen and the failure report can read a shelf of rows without deserialising every one, and
    /// because it is what an unmatched row is ordered and searched by.
    /// </summary>
    public required string Title { get; set; }

    /// <summary>
    /// The resolved IGDB game id, or null while the row is unmatched. No foreign key: IGDB is the
    /// source of truth for games, exactly as on the entry.
    /// </summary>
    public int? GameId { get; set; }

    /// <summary>One of <see cref="ImportMatchKinds"/>.</summary>
    public required string MatchKind { get; set; }

    /// <summary>
    /// The IGDB ids the matcher thought this row might be, best first.
    /// </summary>
    /// <remarks>
    /// Populated only for <see cref="ImportMatchKinds.Ambiguous"/>, and empty for every other kind:
    /// whether a pass has <em>looked</em> is <see cref="MatchKind"/>'s to say, not this column's.
    /// A plain array rather than a document, because that is what it is — PostgreSQL stores it as
    /// <c>integer[]</c> and nothing has to serialise it on the way past.
    /// </remarks>
    public List<int> Candidates { get; set; } = [];

    /// <summary>One of <see cref="ImportDecisions"/>. Defaulted on creation, then the user's to change.</summary>
    public required string Decision { get; set; }

    /// <summary>
    /// The canonical row as JSON — status, score, notes, the wishlist and favourite flags, and the
    /// playthroughs. The shape is <c>ImportRowPayload</c>.
    /// </summary>
    public required string Payload { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public ImportJob Job { get; set; } = null!;
}
