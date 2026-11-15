namespace MyVideoGameList.Server.Models;

/// <summary>
/// How many members a figure about one game has to rest on before the API sends it: the community
/// scores' mean and distribution, and the community times' medians.
/// </summary>
/// <remarks>
/// <para>
/// <b>A privacy boundary, not a display rule.</b> Every member's score and every logged run count,
/// private profiles included (ADR 0028 §2), and the endpoints are public JSON. A mean over one
/// score is that member's score, so under a floor the API sends the count and withholds the figure.
/// The count still travels, as ADR 0016 asks; the figure does not. See <c>docs/decisions/0094-*</c>.
/// </para>
/// <para>
/// The client restates all three in <c>@/lib/score</c>, for the sentences that say why a figure is
/// missing, and <c>serverMirrors.test.ts</c> reads them out of this file. Keep each a
/// <c>public const int</c> written as a literal, or that test cannot find it.
/// </para>
/// </remarks>
public static class CommunityFloors
{
    /// <summary>
    /// Scores a game needs before the API sends their mean. Higher than the playthroughs' floor,
    /// because a score is one tap on a star and a counted run needs a type and a duration typed in
    /// after the game is over (ADR 0028 §3).
    /// </summary>
    public const int MemberScores = 5;

    /// <summary>
    /// Scores a game needs before the API sends how they spread over the scale. Higher than
    /// <see cref="MemberScores"/>, because near that floor the columns are a handful of people's
    /// scores laid out one by one, read in a single look, where the mean is one number over all of
    /// them. It does not stop anybody watching a column go up by one: ADR 0094 §3 and §4.
    /// </summary>
    public const int ScoreDistribution = 20;

    /// <summary>
    /// Playthroughs a tier needs before the API sends its median (ADR 0025 §2).
    /// </summary>
    public const int PlaythroughSamples = 3;
}
