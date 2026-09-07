namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Everything the profile page shows about what one user has done, derived entirely from our own
/// tables.
/// </summary>
/// <remarks>
/// <para>
/// Nothing here needs a game's title, genre or platform, and that is deliberate: a statistic about
/// the user's own behaviour must not stop working because IGDB is down. The breakdowns that do need
/// game metadata are computed on the client from the lists it has already loaded — see
/// <c>docs/decisions/0023-*</c>.
/// </para>
/// <para>
/// No "total hours": nothing records hours yet. A stat that would have to be invented is left out
/// rather than approximated from timestamps that do not mean what it would claim.
/// </para>
/// </remarks>
public record UserStatsDto(LibraryStatsDto Library, ScoreStatsDto Scores, ActivityStatsDto Activity);

/// <summary>
/// What the user is tracking right now. Current state, read from <c>UserGameEntries</c> rather than
/// derived from the event log, because that is what "my library" means.
/// </summary>
/// <param name="Tracked">Entries currently in one of the five statuses.</param>
/// <param name="Recorded">
/// Every entry, including those in no list at all. The difference between this and
/// <paramref name="Tracked"/> is games the user has scored and then taken off their lists, which
/// keep their entry by design (ADR 0019).
/// </param>
/// <param name="ByStatus">Count per status key. Always all five keys, including the empty ones.</param>
/// <param name="CompletionRate">
/// Finished over everything that reached a terminal status, so the denominator is finished plus
/// dropped. Null when nothing has reached one yet — a rate over an empty denominator is not zero,
/// it is unknown, and rendering it as 0% would libel the user.
/// </param>
public record LibraryStatsDto(
    int Tracked,
    int Recorded,
    int Wishlisted,
    IReadOnlyDictionary<string, int> ByStatus,
    double? CompletionRate);

/// <param name="Distribution">
/// Ten buckets, index 0 holding the count of 1s. The scale is the 1-10 the database stores, which
/// is the same scale the star control writes at half-star steps.
/// </param>
/// <param name="Mean">
/// Null when nothing is scored. Deliberately on the 1-10 scale and not a percentage: a percentage
/// in this app means a score averaged from other people (ADR 0021), and this is the user's own.
/// </param>
public record ScoreStatsDto(int Scored, double? Mean, IReadOnlyList<int> Distribution);

/// <summary>
/// What the user has <em>done</em>, which only <c>UserGameEvents</c> can answer — the entry table
/// is overwritten in place on every move.
/// </summary>
/// <param name="LogStartedAt">
/// The user's earliest recorded event, or null if they have none. The client needs this to avoid
/// drawing empty months for a period the log did not exist for: the log shipped in August 2026 and
/// was not backfilled, so "no activity" and "no records" are different claims.
/// </param>
/// <param name="Months">
/// Most recent last, at most twelve, and never reaching back before
/// <paramref name="LogStartedAt"/>.
/// </param>
/// <param name="Transitions">Every recorded status change, all time.</param>
/// <param name="CurrentStreakMonths">
/// Consecutive months ending now that contain a finish. The current month counts as alive if it
/// has a finish <em>or</em> the previous one does, so a streak does not appear to break on the
/// first of every month.
/// </param>
public record ActivityStatsDto(
    DateTimeOffset? LogStartedAt,
    IReadOnlyList<ActivityMonthDto> Months,
    int Transitions,
    int CurrentStreakMonths,
    int LongestStreakMonths,
    ActiveTimeDto? TimeToFinish);

/// <param name="Month">ISO <c>yyyy-MM</c>, in UTC.</param>
/// <param name="Started">Games moved into a status flagged <c>IsStarted</c> for the first time.</param>
public record ActivityMonthDto(string Month, int Started, int Finished, int Dropped);

/// <summary>
/// How long games take, counting only the time they were actually being played.
/// </summary>
/// <remarks>
/// ADR 0018 spells out why this is not <c>finished - first playing</c>: somebody who plays for two
/// weeks, shelves a game for eight months and comes back for three days did not spend nine months
/// on it. Only intervals whose target status was <c>playing</c> are summed, which is possible
/// precisely because the log keeps the intermediate transitions.
/// </remarks>
/// <param name="Samples">
/// Finished games that had at least one playing interval. Games marked finished without ever being
/// marked as playing are excluded rather than counted as zero, and reporting the count is what
/// keeps the median honest about how little it may be based on.
/// </param>
public record ActiveTimeDto(int Samples, double MedianHours, double LongestHours);
