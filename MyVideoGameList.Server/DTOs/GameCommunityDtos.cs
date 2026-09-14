namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// Every member's score for one game, as a count, a mean and a distribution.
/// </summary>
/// <remarks>
/// <para>
/// An aggregate over everybody that names nobody, so every score counts, whatever the profile
/// visibility of the account that gave it — the same basis <see cref="CommunityTimesDto"/> has
/// always had. See <c>docs/decisions/0028-*</c>.
/// </para>
/// <para>
/// Its own type rather than <see cref="ScoreStatsDto"/>, although the two are computed by the same
/// arithmetic. That one is one person's scores and says so in its documentation; this one is
/// everybody's, and a field added to the profile's document must not appear here by nobody's
/// decision.
/// </para>
/// <para>
/// The count travels with the figures for the reason ADR 0016 gives. The display floor lives in the
/// client, as <c>MIN_CRITIC_REVIEWS</c> does — the API reports the sample size faithfully and each
/// caller sets its own bar.
/// </para>
/// </remarks>
/// <param name="Scored">How many members have scored the game.</param>
/// <param name="Mean">
/// On the 1-10 scale scores are entered on, and null when nobody has scored the game. The client
/// shows it out of 100: it is an average of other people's opinions, which is what a percentage
/// means in this app (ADR 0021) — the conversion is the client's, as it is for IGDB's player rating.
/// </param>
/// <param name="Distribution">Ten buckets, index 0 holding the count of 1s.</param>
public record CommunityScoresDto(int Scored, double? Mean, IReadOnlyList<int> Distribution);

/// <summary>
/// A page of the reviews members have published about one game.
/// </summary>
/// <param name="Total">Every published review of the game, not just this page.</param>
public record GameReviewsDto(
    IReadOnlyList<GameReviewDto> Reviews,
    int Total,
    int Page,
    int PageSize);

/// <summary>
/// One published review, with its author's name and the score they gave the game.
/// </summary>
/// <remarks>
/// <para>
/// Only a review its author marked public, by somebody whose profile is public, ever becomes one of
/// these — the narrower of the two settings wins, exactly as it does on the profile (ADR 0027).
/// The author's name can therefore always be linked: there is a profile behind it.
/// </para>
/// <para>
/// Assembled field by field, for the reason <see cref="PublicProfileDto"/> gives. The review's own
/// id and the playthrough it points at are deliberately absent: the first says how many reviews
/// exist site-wide, private ones included, and the second would publish hours and platforms that
/// the public profile itself leaves out.
/// </para>
/// </remarks>
/// <param name="UserName">As its owner capitalised it.</param>
/// <param name="Score">
/// The author's own score, from their entry, on the 1-10 scale they entered it on. Null when they
/// wrote about the game without scoring it.
/// </param>
public record GameReviewDto(
    string UserName,
    string Body,
    bool HasSpoilers,
    short? Score,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);
