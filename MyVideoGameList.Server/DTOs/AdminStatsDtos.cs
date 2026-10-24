namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// What the admin page counts (ADR 0051): totals, and the last twelve weeks one week at a time. Never
/// a list of accounts, and nothing about any one of them.
/// </summary>
public record AdminStatsDto(
    DateTimeOffset CountedAt,
    AdminAccountStatsDto Accounts,
    AdminLibraryStatsDto Library,
    AdminWritingStatsDto Writing,
    AdminImportStatsDto Imports,
    IReadOnlyList<AdminWeekStatsDto> Weeks);

/// <param name="SeenToday">Seen since midnight, UTC.</param>
/// <param name="SeenInSevenDays">Seen today or on any of the six days before it.</param>
/// <param name="SeenInThirtyDays">Seen today or on any of the twenty-nine days before it.</param>
/// <param name="Undated">
/// Created before the dates were recorded, so in no week's sign-ups and seen on no day until they
/// next load a page.
/// </param>
public record AdminAccountStatsDto(
    int Total,
    int PublicProfiles,
    int SeenToday,
    int SeenInSevenDays,
    int SeenInThirtyDays,
    int Undated);

/// <param name="ByStatus">The entries in each list, keyed by the status's key, in the lists' order.</param>
/// <param name="InNoList">
/// Entries kept for a score, a review or a playthrough after leaving every list (ADR 0019).
/// </param>
/// <param name="FromImports">Entries whose status an import last wrote (<c>Origin</c> other than manual).</param>
public record AdminLibraryStatsDto(
    IReadOnlyDictionary<string, int> ByStatus,
    int InNoList,
    int FromImports,
    int Wishlisted,
    int Favourites);

/// <param name="PublicReviews">
/// Reviews their authors marked public. Only those on a public profile are read by anybody else.
/// </param>
/// <param name="TimedPlaythroughs">Playthroughs with a time logged.</param>
public record AdminWritingStatsDto(int Reviews, int PublicReviews, int Playthroughs, int TimedPlaythroughs);

/// <summary>
/// The import jobs the retention sweep still holds: a closed one goes a week after it closes, an
/// unfinished one two weeks after its last decision (ADR 0038). What every import brought in stays
/// countable as <see cref="AdminLibraryStatsDto.FromImports"/>.
/// </summary>
public record AdminImportStatsDto(int Pending, int Done, int Cancelled);

/// <summary>One week, Monday to Sunday in UTC.</summary>
/// <param name="ListMoves">Status changes: every recorded move into, between or out of the lists (ADR 0018).</param>
public record AdminWeekStatsDto(DateOnly Starts, int SignUps, int ListMoves, int Reviews, int Playthroughs);
