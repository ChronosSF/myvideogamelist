namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One user's public page, as anybody on the internet may read it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Every field here is chosen, not inherited.</b> <c>PublicProfileService</c> builds this from
/// the same <see cref="UserStatsDto"/> the owner's own profile is built from, but it copies the
/// parts across one at a time rather than handing the whole thing over. That is the entire reason
/// this type exists: returning <see cref="UserStatsDto"/> directly would mean that every figure
/// ever added to the private profile becomes public on the day it is added, by nobody's decision.
/// A field reaches this document only when somebody writes it into this record.
/// </para>
/// <para>
/// What is deliberately absent: the email address, the account id, anything from the wishlist
/// beyond its size, the per-platform breakdown of hours, and the time-to-finish median. The first
/// two are identity rather than activity; the rest are figures about how somebody spends their
/// evenings that are interesting to their owner and nobody else's business.
/// </para>
/// <para>
/// Nothing here needs a game's title or cover, which is what lets the profile render when IGDB is
/// down — the reviews, which do need them, are a separate request for exactly that reason. See
/// <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
/// </para>
/// </remarks>
/// <param name="UserName">
/// As stored, so the page shows the capitalisation its owner chose rather than whatever the
/// visitor happened to type into the URL.
/// </param>
/// <param name="Reviews">
/// How many public reviews this user has written — the count the page needs before it fetches any
/// of them, and the number that decides whether the section appears at all.
/// </param>
public record PublicProfileDto(
    string UserName,
    PublicActivityDto Activity,
    LibraryStatsDto Library,
    ScoreStatsDto Scores,
    PublicPlaytimeDto Playtime,
    int Reviews);

/// <summary>
/// What the user has done over the last year, and for how long they have been doing it.
/// </summary>
/// <param name="TrackingSince">
/// Their earliest recorded status change, or null when they have none. Not a join date: no such
/// column exists, and inventing one for accounts that predate it would be inventing a fact. What
/// this says — "has been tracking games here since June" — is true and is derived from the log.
/// </param>
/// <param name="Months">
/// The same months <c>ActivityStatsDto</c> carries, trimmed by the server to where the log begins.
/// </param>
public record PublicActivityDto(
    DateTimeOffset? TrackingSince,
    IReadOnlyList<ActivityMonthDto> Months,
    int CurrentStreakMonths,
    int LongestStreakMonths);

/// <summary>
/// Hours logged, as three numbers and no breakdown.
/// </summary>
/// <remarks>
/// The per-platform split is left out rather than trimmed on the client. It would also need the
/// public page to resolve platform ids to names, which the owner's own page does from the lists it
/// has already loaded and a public reader has not.
/// </remarks>
public record PublicPlaytimeDto(int Playthroughs, int TotalMinutes, int WithHours);

/// <summary>
/// A page of one user's public reviews.
/// </summary>
/// <remarks>
/// Separate from <see cref="PublicProfileDto"/> because this is the half that needs IGDB. Folding
/// the two together would mean a third party being down took out a page made almost entirely of
/// our own data.
/// </remarks>
/// <param name="Total">
/// Every public review they have written, not just this page — what "1-20 of 47" needs.
/// </param>
public record PublicReviewsDto(
    string UserName,
    IReadOnlyList<PublicReviewDto> Reviews,
    int Total,
    int Page,
    int PageSize);

/// <summary>
/// One review, with the game it is about and the score its author gave that game.
/// </summary>
/// <remarks>
/// The score comes from the entry rather than from the review, because that is where it lives
/// (ADR 0019) — and it is included here because a review beside a score is the pair a reader wants.
/// It is on the 1-10 scale the user entered it on; the client renders it as stars, which is what
/// stars are for (ADR 0021).
/// </remarks>
/// <param name="Score">Null when the author wrote about the game without scoring it.</param>
public record PublicReviewDto(
    GameDto Game,
    string Body,
    bool HasSpoilers,
    short? Score,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
