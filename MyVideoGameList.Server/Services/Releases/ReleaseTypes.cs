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
public sealed record CalendarGame(
    int Id,
    string Name,
    string? CoverImageUrl,
    int? GameType,
    int? ParentGameId,
    int? VersionParentId,
    IReadOnlyList<SeriesRef> Series);

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
    ReleaseReason Reason);

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
