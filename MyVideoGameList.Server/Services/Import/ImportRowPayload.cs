namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// One game from an uploaded file, reduced to the shape every source produces and the commit
/// consumes. This is the contract `specs/csv-list-import.md` §3.1 describes.
/// </summary>
/// <remarks>
/// <para>
/// Serialised into <c>ImportRow.Payload</c>. Every field is optional except the title, because the
/// title is the only thing some services reliably give us and everything else is a bonus.
/// </para>
/// <para>
/// Nothing here is an IGDB id but <see cref="GameId"/>, and nothing here is one of our database
/// ids at all. A payload is a statement about what the *file* said, mapped into our vocabulary;
/// turning that into rows is the commit's job.
/// </para>
/// </remarks>
/// <param name="Title">As the source spelled it. Shown on the review screen and in the failure report.</param>
/// <param name="ReleaseYear">
/// Disambiguates remakes and reboots. Unused by a source that carries ids, and the second most
/// valuable matching signal for one that does not.
/// </param>
/// <param name="GameId">The IGDB id the source named, when it names one at all.</param>
/// <param name="SourceStatus">
/// The source's own word for where this game sits — "Played", "Wish List", a custom shelf's name.
/// Carried even when it maps cleanly, because the review screen shows the user what their file
/// said rather than only what we made of it.
/// </param>
/// <param name="Status">
/// One of <c>ListStatusKeys</c>, or null. Null is a real and common answer: it is what a game the
/// user has played but not resolved becomes (ADR 0026, ADR 0037), and it is also what an
/// unrecognised shelf leaves behind — <paramref name="StatusUnrecognised"/> is what tells those
/// two apart.
/// </param>
/// <param name="StatusUnrecognised">
/// True when the preset did not understand <paramref name="SourceStatus"/>. Those rows are grouped
/// on the review screen with a dropdown rather than being silently dropped or silently defaulted
/// to Backlog, which is the rule `specs/csv-list-import.md` §3.2 sets.
/// </param>
/// <param name="Score">
/// Normalised to our 1–10, from whatever the source uses. Five-star, hundred-point and letter
/// grades all occur in the wild.
/// </param>
/// <param name="Wishlist">Some services model wanting a game as a shelf, some as a flag. Both land here.</param>
/// <param name="Favourite">As <paramref name="Wishlist"/>, for the other axis (ADR 0029).</param>
/// <param name="Notes">
/// Long text, possibly with newlines. Lands on the entry's private notes and never on a
/// <c>Review</c> — publishing somebody's prose is not a default worth having (ADR 0037).
/// </param>
/// <param name="AddedAt">
/// When the source says the user first recorded this game, if it says. Using the import's own
/// timestamp instead would put an entire imported library at the top of "recently added" and bury
/// everything the user actually touched — the harm ADR 0026 §5 describes for <c>StatusChangedAt</c>,
/// and avoidable here because this is a real date rather than a guessed one.
/// </param>
/// <param name="Playthroughs">Zero or more runs. A source with no notion of one produces none.</param>
internal sealed record ImportRowPayload(
    string Title,
    int? ReleaseYear,
    int? GameId,
    string? SourceStatus,
    string? Status,
    bool StatusUnrecognised,
    short? Score,
    bool Wishlist,
    bool Favourite,
    string? Notes,
    DateTimeOffset? AddedAt,
    IReadOnlyList<ImportPlaythroughPayload> Playthroughs);

/// <summary>
/// One run through a game, as the source recorded it.
/// </summary>
/// <remarks>
/// <para>
/// There is deliberately <b>no type</b>. Our three — rushed, normally, completionist — are what
/// decide whether a run counts towards the community medians (ADR 0016, ADR 0025), and a tracker's
/// completion field is not reliably a statement: Grouvee's reads "Main Story" on 596 of 608 rows,
/// including all 448 that carry no date and no hours at all, because that is what it writes into
/// the row it creates when a game is shelved.
/// </para>
/// <para>
/// So an imported run keeps its dates and its duration and carries no type, which means it shows on
/// its owner's profile and in their own playtime figures and contributes nothing to a figure other
/// members read. A typeless playthrough is already a supported shape, so this needs no special case
/// anywhere. See ADR 0037, decision 4.
/// </para>
/// </remarks>
/// <param name="MinutesPlayed">
/// Never zero. A source that writes 0 for "not recorded" — Grouvee's <c>seconds_played</c> does —
/// must produce null here: the column's check constraint requires at least a minute, and a zero
/// would be a claim nobody made.
/// </param>
/// <param name="PlatformName">
/// Free text, resolved to an IGDB platform id at commit time if it resolves at all. A name we
/// cannot place leaves the platform null rather than failing the run.
/// </param>
internal sealed record ImportPlaythroughPayload(
    DateOnly? StartedOn,
    DateOnly? FinishedOn,
    int? MinutesPlayed,
    string? PlatformName);
