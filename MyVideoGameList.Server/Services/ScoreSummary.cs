namespace MyVideoGameList.Server.Services;

/// <summary>
/// The count, mean and ten-column distribution of a set of 1-10 scores — one person's across the
/// games they have scored, or everybody's for one game.
/// </summary>
/// <remarks>
/// One implementation for both, because the profile's histogram and the game page's are the same
/// arithmetic over a different scope. Two copies would be two answers waiting to disagree about the
/// edge case below, which is the argument ADR 0027 makes against re-deriving a figure.
/// </remarks>
internal static class ScoreSummary
{
    public static (int Scored, double? Mean, int[] Distribution) Of(IEnumerable<short?> scores)
    {
        // A check constraint holds the column to 1-10 in PostgreSQL, but the in-memory provider the
        // tests run on enforces no constraints, and a score outside the range is corrupt rather
        // than merely unusual. It is left out of all three figures together — a 42 dropped from the
        // histogram but kept in the mean would put "24 out of 10" on the page, which is worse than
        // a mean over one fewer score.
        var valid = scores
            .Where(score => score is >= 1 and <= 10)
            .Select(score => (int)score!.Value)
            .ToList();

        var distribution = new int[10];
        foreach (var score in valid) distribution[score - 1]++;

        return (valid.Count, valid.Count == 0 ? null : valid.Average(), distribution);
    }
}
