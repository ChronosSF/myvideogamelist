using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>One game IGDB offered in answer to a search, reduced to what deciding needs.</summary>
/// <remarks>
/// Not a <c>GameDto</c>, so that the rule below is a function of three facts and can be read,
/// tested and argued with as one. Cover art and platforms matter to the person choosing between
/// candidates and not at all to which candidates are worth offering.
/// </remarks>
/// <param name="RatingCount">
/// How many ratings IGDB's blended score for this entry is built from — <c>GameDto.RatingCount</c>.
/// Carried here as a measure of <em>how many people track this row</em> rather than of how good the
/// game is, which is what makes it able to tell a release apart from a stub of the same name. See
/// <see cref="ImportMatching.MinimumFollowing"/>.
/// </param>
internal sealed record ImportCandidate(int GameId, string Title, int? ReleaseYear, int? RatingCount);

/// <summary>
/// Which IGDB game a title names, or that we cannot say. <c>specs/csv-list-import.md</c> §M2.
/// </summary>
/// <remarks>
/// <para>
/// Separated from the service that fetches the candidates for the reason <c>ImportRetention</c> is
/// separated from the sweep: the <em>decision</em> is the part worth pinning, and it is a pure
/// function of one query and a list of candidates, so every rule in it can be stated as a test
/// without a substitute for IGDB in sight.
/// </para>
/// <para>
/// <b>The tiers are not a confidence score rounded into buckets.</b> They are three different
/// claims, and only one of them writes anything without being asked:
/// </para>
/// <list type="bullet">
/// <item><c>matched</c> — exactly one candidate whose <see cref="ImportTitle.Normalise"/> key is
/// the query's, and no year that rules it out. This row is pre-checked on the review screen, so it
/// is the only tier that can put a game in somebody's library through inattention, and every rule
/// here is written around that.</item>
/// <item><c>ambiguous</c> — a candidate is worth looking at but choosing is not ours to do: several
/// titles are identical, or the best is a near miss, or the years disagree. Up to
/// <see cref="MaxCandidates"/> are offered and the row stays set to skip until somebody picks one
/// (§M3).</item>
/// <item><c>unmatched</c> — nothing came back worth offering. The row imports nothing and appears
/// in the failure report, which is the outcome §C5 promises rather than one to be avoided.</item>
/// </list>
/// </remarks>
internal static class ImportMatching
{
    /// <summary>
    /// How alike two normalised titles must be before one is worth offering as a candidate at all.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A Dice coefficient over character pairs, so the threshold is in units of "what fraction of
    /// the adjacent letter pairs do these two names share". At 0.82 a letter out of place in a
    /// dozen still reaches its game, while "bioshock" does not reach "bioshock infinite" — a
    /// different game with most of a name in common.
    /// </para>
    /// <para>
    /// <b>It is not a spellchecker, whatever the first example suggests.</b> IGDB's own search is
    /// what decides which candidates exist at all, and it is not fuzzy: searching it for
    /// "Resedent Evil" returns nothing whatsoever, so no score here can rescue a misspelled row.
    /// What this floor really governs is the case where IGDB returns the game and its title is
    /// longer or shorter than the file's — a missing subtitle, an extra word — which is the
    /// difference a character score is actually good at.
    /// </para>
    /// <para>
    /// Tuned against invented examples, which is the honest thing to say about it: no id-less
    /// export has been read yet. It is deliberately a named constant with tests naming both sides
    /// of it, so the first real file can move it with an argument rather than a rewrite.
    /// </para>
    /// </remarks>
    internal const double MinimumSimilarity = 0.82;

    /// <summary>
    /// The score for a candidate that differs from the query by an edition suffix and nothing else.
    /// </summary>
    /// <remarks>
    /// High, because "Dark Souls" is plainly the right thing to offer somebody importing "Dark
    /// Souls Remastered" — and deliberately short of 1, because <see cref="Automatic"/> reads
    /// <see cref="Scored.Exact"/> rather than a number and this must never become an answer.
    /// </remarks>
    internal const double EditionSimilarity = 0.95;

    /// <summary>How many candidates an ambiguous row offers. §M3.</summary>
    internal const int MaxCandidates = 5;

    /// <summary>
    /// How far a candidate's release year may be from the file's and still be the same game. §M2.
    /// </summary>
    /// <remarks>
    /// One, because a service records the year of the release its user owns and a game reaches
    /// different territories and platforms in different years. Two would start admitting the
    /// annual sports titles this is most needed for.
    /// </remarks>
    internal const int YearTolerance = 1;

    /// <summary>
    /// How far ahead of its nearest rival an identically titled entry must be, in ratings, before
    /// it is treated as the one a person means.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>IGDB holds one row per release, not one per game, and that breaks the obvious rule.</b>
    /// A search for "Final Fantasy VII" answers with seven entries all titled exactly that; for
    /// "Resident Evil 2", six; for "Hollow Knight", two. So "exactly one exact title" — which is
    /// what §M2 proposes — is not a condition that holds for the games people actually own, and a
    /// matcher built on it alone would send almost every popular row to be resolved by hand.
    /// </para>
    /// <para>
    /// What separates them, measured against live IGDB rather than assumed: the canonical row has
    /// one or two orders of magnitude more ratings than the re-release stubs beside it. Final
    /// Fantasy VII is 1,633 against 42, 18, 9 and three zeroes; Hollow Knight 2,248 against zero;
    /// Ocarina of Time 2,168 against zero; Resident Evil 2 in 1998 is 604 against two zeroes.
    /// </para>
    /// <para>
    /// Ten, because the cases that must <em>not</em> resolve are the ones where both entries have a
    /// real following and the choice is genuinely the owner's: Resident Evil 2's 1998 original and
    /// 2019 remake sit at 604 and 1,440, and Shadow of the Colossus at 1,339 and 389. Every stub
    /// measured is beyond a factor of thirty away; every real pair is inside a factor of four.
    /// </para>
    /// </remarks>
    internal const int DominantFollowing = 10;

    /// <summary>
    /// The fewest ratings a leader needs before its lead counts for anything.
    /// </summary>
    /// <remarks>
    /// Without this, one rating against none is a landslide, and an obscure game with two IGDB rows
    /// would be resolved by a coin toss dressed as evidence. Every canonical entry measured is far
    /// above this — the smallest, Wario Land 4, has 79 — so it costs nothing where the signal is
    /// real and withholds it where there is none.
    /// </remarks>
    internal const int MinimumFollowing = 25;

    private static readonly ImportMatchResult Nothing = new(ImportMatchKinds.Unmatched, null, []);

    /// <summary>What to do with one row, given what IGDB offered for it.</summary>
    public static ImportMatchResult Resolve(ImportMatchQuery query, IReadOnlyList<ImportCandidate> candidates)
    {
        var wanted = ImportTitle.Keys(query.Title);

        // A title of nothing but punctuation. Searching for it would return whatever IGDB makes of
        // an empty query, and matching against that is worse than admitting we cannot read the row.
        if (wanted.Key.Length == 0) return Nothing;

        var scored = candidates
            .Select(candidate => Score(candidate, wanted, query.ReleaseYear))
            .Where(candidate => candidate.Similarity >= MinimumSimilarity)

            // Numbers that disagree are a rejection and not a demotion: "Dark Souls 3" is not an
            // unrelated string to "Dark Souls", it is a wrong answer that looks like a right one,
            // and no similarity makes up for it. Said outright rather than as a penalty heavy
            // enough to fall under the floor, because that would quietly tie a rejection to the
            // one constant here most likely to be retuned against a real export. Tested after the
            // floor, so it costs nothing for the candidates a search returns that are nothing like
            // the row.
            .Where(candidate => candidate.Keys.Numbers.SetEquals(wanted.Numbers))

            // An exact key always scores 1, so it sorts first without being named here. The year
            // gap breaks the tie between two of them, which is what puts the 2019 Resident Evil 2
            // above the 1998 one for somebody whose file says 2019. Then the following, so that a
            // list of identically titled rows leads with the one people actually track rather than
            // with whichever IGDB numbered first. The id last, so the same answer twice is the same
            // list twice.
            .OrderByDescending(candidate => candidate.Similarity)
            .ThenBy(candidate => candidate.YearGap ?? int.MaxValue)
            .ThenByDescending(candidate => candidate.Candidate.RatingCount ?? 0)
            .ThenBy(candidate => candidate.Candidate.GameId)
            .ToList();

        if (scored.Count == 0) return Nothing;

        // Decided over everything that cleared the floor, and only then cut to what the screen
        // shows. The other order looks equivalent and is not: the cap keeps the closest years
        // first, so a well-followed release a year out could fall off the end and stop being the
        // rival that was holding the decision open — turning "ask" into a confident wrong answer,
        // which is the same trap a small ImportMatcher.CandidatePool sets.
        return Automatic(scored) is { } chosen
            ? new ImportMatchResult(ImportMatchKinds.Matched, chosen, [])
            : new ImportMatchResult(
                ImportMatchKinds.Ambiguous,
                null,
                scored.Take(MaxCandidates).Select(c => c.Candidate.GameId).ToList());
    }

    /// <summary>
    /// The one candidate this can be answered with, or null when it cannot be answered.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Only an exact key is eligible, so no amount of similarity adds up to an automatic match: a
    /// near miss is always somebody's decision. Among those, a candidate is ruled out when both
    /// sides name a year and they are more than <see cref="YearTolerance"/> apart — which is how a
    /// remake and its original, identically titled, come apart.
    /// </para>
    /// <para>
    /// <b>A candidate with no year is never ruled out</b>, and that asymmetry is deliberate. Not
    /// knowing when a game came out is not evidence against it, so an undated candidate survives
    /// beside a dated one and has to be beaten on something else rather than dismissed. The
    /// alternative — treating "unknown" as "wrong" — would let a missing field in IGDB decide which
    /// game somebody gets. The file's own missing year needs no case of its own for the same
    /// reason: with nothing to compare, no gap is known and nothing is excluded.
    /// </para>
    /// <para>
    /// Survivors are then allowed to be several, because IGDB holds a row per release and a popular
    /// game has half a dozen carrying its exact title. One of them may still be the answer, but
    /// only when the others are not rivals at all — see <see cref="DominantFollowing"/>. Two
    /// entries with real followings are a real question, and are left as one.
    /// </para>
    /// </remarks>
    private static int? Automatic(List<Scored> scored)
    {
        var surviving = scored
            .Where(candidate => candidate.Exact && candidate.YearGap is null or <= YearTolerance)
            .OrderByDescending(candidate => candidate.Candidate.RatingCount ?? 0)
            .ToList();

        if (surviving.Count == 0) return null;
        if (surviving.Count == 1) return surviving[0].Candidate.GameId;

        var leader = surviving[0].Candidate.RatingCount ?? 0;
        var rival = surviving[1].Candidate.RatingCount ?? 0;

        return leader >= MinimumFollowing && rival * DominantFollowing < leader
            ? surviving[0].Candidate.GameId
            : null;
    }

    private static Scored Score(ImportCandidate candidate, TitleKeys wanted, int? year)
    {
        var keys = ImportTitle.Keys(candidate.Title);
        var exact = string.Equals(keys.Key, wanted.Key, StringComparison.Ordinal);

        var similarity = exact
            ? 1
            : string.Equals(keys.Loose, wanted.Loose, StringComparison.Ordinal)
                ? EditionSimilarity
                : Similarity(wanted.Key, keys.Key);

        var gap = year is { } asked && candidate.ReleaseYear is { } released
            ? Math.Abs(asked - released)
            : (int?)null;

        return new Scored(candidate, keys, exact, similarity, gap);
    }

    /// <summary>
    /// How alike two strings are, as the Dice coefficient over their adjacent character pairs:
    /// twice the pairs they share, over the pairs they have between them.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Chosen over an edit distance because it is insensitive to where the difference is. A missing
    /// subtitle, a transposed word and a typo all cost roughly what they are worth, whereas an edit
    /// distance normalised by length punishes a long title for a short omission. It is also
    /// symmetric and needs no matrix.
    /// </para>
    /// <para>
    /// Counted as a multiset — a pair occurring twice in one string is only shared twice if it
    /// occurs twice in the other — so that a repeated word cannot inflate the score.
    /// </para>
    /// </remarks>
    internal static double Similarity(string left, string right)
    {
        if (left.Length < 2 || right.Length < 2)
            return string.Equals(left, right, StringComparison.Ordinal) ? 1 : 0;

        var pairs = new Dictionary<(char, char), int>(left.Length - 1);

        for (var i = 0; i < left.Length - 1; i++)
        {
            var pair = (left[i], left[i + 1]);
            pairs[pair] = pairs.GetValueOrDefault(pair) + 1;
        }

        var shared = 0;

        for (var i = 0; i < right.Length - 1; i++)
        {
            var pair = (right[i], right[i + 1]);

            if (pairs.TryGetValue(pair, out var remaining) && remaining > 0)
            {
                pairs[pair] = remaining - 1;
                shared++;
            }
        }

        return 2.0 * shared / (left.Length - 1 + right.Length - 1);
    }

    /// <param name="Exact">
    /// The candidate's conservative key is the query's. The only thing that makes a candidate
    /// eligible to be chosen rather than offered.
    /// </param>
    /// <param name="YearGap">Years apart, or null when either side does not say.</param>
    private readonly record struct Scored(
        ImportCandidate Candidate, TitleKeys Keys, bool Exact, double Similarity, int? YearGap);
}
