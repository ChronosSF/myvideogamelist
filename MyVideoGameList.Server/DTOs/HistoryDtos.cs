namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// A page of the signed-in user's history, newest first: their status changes, the scores they have
/// given, and the start and finish dates of their playthroughs, as one list.
/// </summary>
/// <remarks>
/// <para>
/// The owner's alone. Nothing here reaches the public profile, which publishes counts and never a
/// dated record of what somebody did with which game (ADR 0027 §8, ADR 0062).
/// </para>
/// <para>
/// Every item is read from a row the user wrote, at the moment that row records. Nothing is
/// inferred and nothing is synthesised, so what has no moment of its own is absent rather than
/// placed somewhere plausible — which is what the two counts are for.
/// </para>
/// </remarks>
/// <param name="Next">
/// What to pass as <c>after</c> for the page that follows, or null when this is the last. A position
/// in the order rather than a page number, encrypted — see <c>HistoryCursor</c>.
/// </param>
/// <param name="ImportedStatuses">
/// How many of the user's games were put in a list by an import, which records where a game sat and
/// never when it got there, so no item stands for those placements (ADR 0026, 0037). Read from
/// <c>Origin</c>, the column that exists to make this checkable rather than inferred from an
/// absence. The same on every page.
/// </param>
/// <param name="UndatedScores">
/// How many scores have no moment — given before the history kept one, or brought in by an import —
/// and so no item. The same on every page.
/// </param>
public record HistoryPageDto(
    IReadOnlyList<HistoryItemDto> Items,
    string? Next,
    int ImportedStatuses,
    int UndatedScores);

/// <summary>
/// One thing the user recorded, of one of four kinds, about one game.
/// </summary>
/// <remarks>
/// <para>
/// One shape for the four, with the fields a kind does not use left null, because the list is one
/// list: a client walks it in order and reads the fields its kind names. The kinds are the permanent
/// keys in <c>HistoryKinds</c>.
/// </para>
/// <para>
/// No id of any row. The order is carried by <see cref="HistoryPageDto.Next"/>, and an event's id
/// would say how many status changes everybody has ever made.
/// </para>
/// </remarks>
/// <param name="Kind">
/// <c>status</c>, <c>score</c>, <c>playthrough_started</c> or <c>playthrough_finished</c>.
/// </param>
/// <param name="At">
/// The instant, for a status change and a score. Null for a playthrough's date, which has none.
/// </param>
/// <param name="On">
/// The calendar day, for a playthrough's start or finish, as its owner wrote it — no time and no
/// zone. Null for the other two kinds.
/// </param>
/// <param name="Game">
/// The title and cover, from <c>CachedGames</c>. Null when this app holds no copy of the game, which
/// is a game IGDB no longer lists or one never fetched while IGDB is down; the item stays, because
/// the record it stands for is still the user's.
/// </param>
/// <param name="FromStatus">
/// For a status change: the status key left behind, or null when the game was in no list.
/// </param>
/// <param name="ToStatus">
/// For a status change: the status key arrived at, or null when the game left every list.
/// </param>
/// <param name="Score">For a score: the score now held, on the 1–10 scale it was entered on.</param>
/// <param name="PlaythroughType">
/// For a playthrough's date: the run's type key, or null when it has none — a run still going, or
/// one nobody said how thoroughly it was played.
/// </param>
public record HistoryItemDto(
    string Kind,
    DateTimeOffset? At,
    DateOnly? On,
    int GameId,
    GameRefDto? Game,
    string? FromStatus,
    string? ToStatus,
    short? Score,
    string? PlaythroughType);
