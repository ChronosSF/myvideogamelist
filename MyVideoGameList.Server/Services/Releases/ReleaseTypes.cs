using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services.Releases;

/// <summary>How much of a release date IGDB knows — its <c>date_format</c> (spec §4). Finest first.</summary>
public enum ReleasePrecision
{
    Day,
    Month,
    Quarter,
    Year,
}

/// <summary>How a release is connected to a game in the user's set (spec §3.2). Strongest first.</summary>
public enum ReleaseRelation
{
    /// <summary>R1: the game itself — a new platform, or an early-access game reaching its full release.</summary>
    Itself,

    /// <summary>R2: a game whose <c>parent_game</c> is one of the set's — DLC, an expansion, a remaster.</summary>
    Child,

    /// <summary>R3: another game in one of the set's series.</summary>
    Series,
}

/// <summary>Why a game is in the user's set (spec §3.1). Strongest first, as §3.4 ranks them.</summary>
public enum SetMembership
{
    Favourite,
    Wishlist,
    List,
}

/// <summary>
/// A game in the user's set, under its strongest membership: a favourite that is also on the Backlog
/// is a favourite here.
/// </summary>
/// <param name="ListKey">The status's key when the membership is a list — "you finished God of War".</param>
public sealed record SetMember(int GameId, SetMembership Membership, string? ListKey);

/// <summary>An IGDB series — a <c>collection</c>.</summary>
public sealed record SeriesRef(int Id, string Name);

/// <summary>
/// A game as the release calendar needs it: enough to draw it, to fold an edition into the game it is
/// an edition of, and to say how it is connected to somebody's games.
/// </summary>
/// <param name="GameType">IGDB's <c>game_type</c>; see <see cref="IgdbGameTypes"/>.</param>
/// <param name="Dated">
/// Whether IGDB has a release date for it anywhere, to any precision — its <c>first_release_date</c> is
/// set. A game without one is announced with no date at all (K4). Assumed dated unless IGDB says
/// otherwise, so that no game is ever listed as undated for want of asking.
/// </param>
/// <param name="GameStatus">IGDB's <c>game_status</c>; see <see cref="IgdbGameStatuses"/>. Null for most games.</param>
public sealed record CalendarGame(
    int Id,
    string Name,
    string? CoverImageUrl,
    int? GameType,
    int? ParentGameId,
    int? VersionParentId,
    IReadOnlyList<SeriesRef> Series,
    bool Dated = true,
    int? GameStatus = null);

/// <summary>
/// One of IGDB's <c>release_dates</c> rows: one game, one platform, one date and how much of that date
/// is known.
/// </summary>
/// <param name="Date">
/// The day, or — for a row known only to its month, quarter or year — IGDB's stand-in for it: the first
/// of the month, the last day of the quarter, the last day of the year (spec §4). Read it together
/// with <paramref name="DateFormat"/>, never alone.
/// </param>
public sealed record ReleaseRow(
    int Id,
    int GameId,
    DateOnly Date,
    int? DateFormat,
    int? Year,
    int? Month,
    PlatformDto? Platform,
    int? Status);

/// <summary>What IGDB answered for a set: the rows, and whether it stopped short of all of them.</summary>
public sealed record ConnectedReleaseRows(IReadOnlyList<ReleaseRow> Rows, bool Truncated);

/// <summary>
/// One of IGDB's <c>release_dates</c> rows with no date at all — <c>date_format</c> 7, "to be decided".
/// IGDB sends no <c>date</c>, <c>y</c> or <c>m</c> with one, so there is nothing to place it by.
/// </summary>
public sealed record UndatedRow(int Id, int GameId, PlatformDto? Platform, int? Status);

/// <summary>The undated rows IGDB answered for a set, and whether it stopped short of all of them.</summary>
public sealed record UndatedReleaseRows(IReadOnlyList<UndatedRow> Rows, bool Truncated);

/// <summary>The reason an entry is shown (spec §3.4): the game in the set that brought it in, and how.</summary>
/// <param name="ViaTitle">Null only for a game IGDB no longer answers for.</param>
/// <param name="Series">The series they share, for <see cref="ReleaseRelation.Series"/>.</param>
public sealed record ReleaseReason(
    ReleaseRelation Relation,
    int ViaGameId,
    string? ViaTitle,
    SetMembership Membership,
    string? ListKey,
    SeriesRef? Series);

/// <summary>A release as F6 groups it, dated or not: the game it is shown as, and why.</summary>
public interface IShownRelease
{
    CalendarGame Game { get; }
    ReleaseReason Reason { get; }
}

/// <summary>
/// One game releasing in one period — the day, or the month, quarter or year it is known to — with every
/// platform it arrives on then (F5).
/// </summary>
/// <param name="Starts">The day, or the first day of the period.</param>
public sealed record ConnectedRelease(
    CalendarGame Game,
    ReleasePrecision Precision,
    DateOnly Starts,
    IReadOnlyList<PlatformDto> Platforms,
    bool EarlyAccess,
    ReleaseReason Reason) : IShownRelease;

/// <summary>
/// A connected game announced with no date at all (K4), with every platform it is announced for (F5).
/// </summary>
public sealed record UndatedRelease(
    CalendarGame Game,
    IReadOnlyList<PlatformDto> Platforms,
    bool EarlyAccess,
    ReleaseReason Reason) : IShownRelease;

/// <summary>
/// What the calendar lists under "Announced, no date" as one thing: a game, or several that belong together
/// (F6) — "God of War — 3 releases".
/// </summary>
/// <param name="GroupName">The series or game they belong to, when there are several; null for one.</param>
public sealed record UndatedEntry(string? GroupName, IReadOnlyList<UndatedRelease> Releases);

/// <summary>
/// What the line and the calendar draw as one thing: a release, or several in the same period that
/// belong together (F6) — "Kingdom Hearts — 8 releases".
/// </summary>
/// <param name="GroupName">The series or game they belong to, when there are several; null for one.</param>
public sealed record ReleaseEntry(
    ReleasePrecision Precision,
    DateOnly Starts,
    string? GroupName,
    IReadOnlyList<ConnectedRelease> Releases);

/// <summary>
/// One of IGDB's <c>events</c> — a showcase, a festival, a convention — as instants rather than days.
/// </summary>
/// <remarks>
/// Kept as instants all the way to the browser, unlike a release or a curated sale. A day is somebody's
/// local one, and a show that airs at three in the afternoon in Los Angeles airs after midnight in Sofia:
/// only the reader's own clock can say which day to draw it on.
/// </remarks>
/// <param name="EndsAt">Null for an event IGDB gave no end.</param>
/// <param name="LiveStreamUrl">Where to watch it; only ever an <c>http</c> or <c>https</c> address.</param>
public sealed record GameEvent(
    int Id,
    string Name,
    DateTimeOffset StartsAt,
    DateTimeOffset? EndsAt,
    string? LiveStreamUrl);

/// <summary>
/// IGDB's <c>game_types</c>, as read from a live response on 2026-09-28. The values IGDB assigns
/// rather than ours, so nothing here may be renumbered.
/// </summary>
public static class IgdbGameTypes
{
    public const int MainGame = 0;
    public const int Dlc = 1;
    public const int Expansion = 2;
    public const int Bundle = 3;
    public const int StandaloneExpansion = 4;
    public const int Mod = 5;
    public const int Episode = 6;
    public const int Season = 7;
    public const int Remake = 8;
    public const int Remaster = 9;
    public const int ExpandedGame = 10;
    public const int Port = 11;
    public const int Fork = 12;
    public const int Pack = 13;
    public const int Update = 14;
}

/// <summary>
/// IGDB's <c>release_date_statuses</c>, as read from a live response on 2026-09-28 — only the ones the
/// rules name.
/// </summary>
public static class IgdbReleaseStatuses
{
    public const int EarlyAccess = 3;
    public const int Offline = 4;
    public const int FullRelease = 6;
}

/// <summary>
/// IGDB's <c>game_statuses</c>, as read from a live response on 2026-10-08 — only the ones the rules
/// name. A status of the game as a whole, unlike <see cref="IgdbReleaseStatuses"/>, which is one row's.
/// </summary>
public static class IgdbGameStatuses
{
    public const int Cancelled = 6;
    public const int Rumored = 7;
}
