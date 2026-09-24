using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which IGDB game a title names, and — far more importantly — when we refuse to say.
/// </summary>
/// <remarks>
/// <para>
/// The two failures this code can produce are not worth the same. A row wrongly resolved is
/// pre-checked on the review screen and imports a game its owner never played, silently, into a
/// library they will not audit; a row left ambiguous costs them one click. So most of what is
/// pinned below is the second kind of answer: the cases where a confident-looking candidate is
/// deliberately not chosen.
/// </para>
/// <para>
/// Two different kinds of number appear below, and it is worth knowing which is which. The
/// <em>similarity</em> thresholds are reasoned against invented titles: no export without IGDB ids
/// has been read yet — <c>specs/csv-list-import.md</c> §2 names HowLongToBeat and Backloggery as
/// the first two — so those are arguments rather than measurements, and each is a named constant
/// with a test either side of it so the first real file can move one without a rewrite. The
/// <em>following</em> figures are the opposite: every one of them was read off live IGDB while this
/// was written, and the duplicate-title problem they solve was found there rather than reasoned
/// about. See ADR 0040.
/// </para>
/// </remarks>
public class ImportMatchingTests
{
    private static ImportCandidate Candidate(
        int id, string title, int? year = null, int? ratings = null) =>
        new(id, title, year, ratings);

    private static ImportMatchResult Resolve(
        string title, int? year, params ImportCandidate[] candidates) =>
        ImportMatching.Resolve(new ImportMatchQuery(title, year), candidates);

    // ── how a title is reduced ──────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Assassin's Creed", "assassins creed")]
    [InlineData("ASSASSIN'S CREED", "assassins creed")]
    [InlineData("Assassin’s Creed", "assassins creed")]
    [InlineData("Spider-Man", "spider man")]
    [InlineData("Star Wars: Knights of the Old Republic", "star wars knights of the old republic")]
    [InlineData("  Portal   2  ", "portal 2")]
    [InlineData("Ratchet & Clank", "ratchet and clank")]
    [InlineData("Ōkami", "okami")]
    [InlineData("Pokémon Red", "pokemon red")]
    [InlineData("Halo™", "halo")]
    public void Normalise_TwoSpellingsOfOneName_AreOneKey(string title, string expected)
    {
        // Case, apostrophes, hyphens, colons, ampersands, accents and trademark symbols are all
        // differences between how two services typed a name rather than between two names. The
        // same function runs over the file's title and over IGDB's, so every rule here has to be
        // true of both — which is what makes removing them safe rather than lossy.
        Assert.Equal(expected, ImportTitle.Normalise(title));
    }

    [Theory]
    [InlineData("The Last of Us", "last of us")]
    [InlineData("A Way Out", "way out")]
    [InlineData("An American Tail", "american tail")]
    public void Normalise_ALeadingArticle_IsDropped(string title, string expected)
    {
        // Services disagree about whether to keep one and about whether they sort under it, so a
        // library exported from one and matched against another needs them gone from both sides.
        Assert.Equal(expected, ImportTitle.Normalise(title));
    }

    [Theory]
    [InlineData("The", "the")]
    [InlineData("A", "a")]
    public void Normalise_ATitleThatIsNothingButAnArticle_KeepsIt(string title, string expected)
    {
        // Dropping it would leave an empty key, which the matcher reads as "unreadable row" and
        // refuses outright. A one-word title is a real thing; a nameless one is not.
        Assert.Equal(expected, ImportTitle.Normalise(title));
    }

    [Theory]
    [InlineData("Final Fantasy VII", "final fantasy 7")]
    [InlineData("Final Fantasy 7", "final fantasy 7")]
    [InlineData("Grand Theft Auto V", "grand theft auto 5")]
    [InlineData("Civilization VI", "civilization 6")]
    [InlineData("Part I", "part 1")]
    public void Normalise_ARomanNumeral_BecomesTheSameDigitsEitherWayItIsWritten(
        string title, string expected)
    {
        // The reason this rule exists at all: a hand-typed library writes "Final Fantasy 7" and
        // IGDB writes "Final Fantasy VII". Without folding they are two games.
        Assert.Equal(expected, ImportTitle.Normalise(title));
    }

    [Theory]
    [InlineData("Mix")]
    [InlineData("Civic")]
    [InlineData("Lid")]
    [InlineData("Dim")]
    public void Normalise_AnOrdinaryWordSpelledInRomanLetters_IsNotANumber(string word)
    {
        // Every letter of a roman numeral is also an ordinary letter, so an unbounded fold rewrites
        // real words: MIX is a canonical 1009 and CIVIC is full of numeral letters too. Stopping
        // the table at thirty — high enough for any sequel, low enough to need only i, v and x —
        // is what keeps these intact, and it is the whole of the guard.
        Assert.Equal(word.ToLowerInvariant(), ImportTitle.Normalise(word));
    }

    [Fact]
    public void Normalise_AnEditionSuffix_Survives()
    {
        // The conservative key keeps it, because "Dark Souls" and "Dark Souls Remastered" are two
        // rows in IGDB and choosing between them is not ours to do. WithoutEdition is what strips
        // it, and its output can only ever offer a candidate.
        Assert.Equal("dark souls remastered", ImportTitle.Normalise("Dark Souls Remastered"));
        Assert.Equal("dark souls", ImportTitle.WithoutEdition("Dark Souls Remastered"));
    }

    [Theory]
    [InlineData("The Witcher 3: Wild Hunt - Game of the Year Edition", "witcher 3 wild hunt")]
    [InlineData("Skyrim Special Edition", "skyrim")]
    [InlineData("BioShock Remastered", "bioshock")]
    [InlineData("Metro 2033 Redux", "metro 2033")]
    [InlineData("Final Fantasy VII Remake", "final fantasy 7")]
    [InlineData("Deus Ex: Director's Cut", "deus ex")]
    [InlineData("Okami HD", "okami")]
    public void WithoutEdition_ATrailingEdition_IsRemoved(string title, string expected)
    {
        Assert.Equal(expected, ImportTitle.WithoutEdition(title));
    }

    [Theory]
    [InlineData("Remastered")]
    [InlineData("Redux")]
    public void WithoutEdition_ATitleThatIsOnlyAnEditionWord_KeepsIt(string title)
    {
        // Reducing a title to nothing is worse than leaving it whole: an empty key is refused
        // outright, so a game genuinely called this would stop being importable.
        Assert.Equal(title.ToLowerInvariant(), ImportTitle.WithoutEdition(title));
    }

    [Fact]
    public void Tidy_KeepsTheUsersOwnSpelling()
    {
        // What IGDB is searched with, and deliberately not the normalised key. IGDB matches against
        // its own index of its own titles, so the best term is the one closest to ordinary text;
        // stripping articles or rewriting numerals here would be guessing at somebody else's
        // tokeniser, and guessing wrong loses a candidate that never appears at all.
        Assert.Equal("The Legend of Zelda: Ocarina of Time", ImportTitle.Tidy("The Legend of Zelda: Ocarina of Time"));
        Assert.Equal("Halo: Combat Evolved", ImportTitle.Tidy("  Halo™:   Combat Evolved \n"));
    }

    // ── what gets chosen ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_OneCandidateSpelledDifferently_IsMatched()
    {
        var result = Resolve("assassins creed 2", 2009, Candidate(41, "Assassin's Creed II", 2009));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(41, result.GameId);
        Assert.Empty(result.Candidates);
    }

    [Fact]
    public void Resolve_OneCandidateAndNeitherSideNamesAYear_IsMatched()
    {
        // Backloggery's export has no year at all, so this is the ordinary case for a whole preset
        // rather than an edge. An exact key with nothing to contradict it is an answer.
        var result = Resolve("Portal 2", null, Candidate(7, "Portal 2"));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(7, result.GameId);
    }

    [Fact]
    public void Resolve_TwoGamesWithOneNameAndAYearThatSeparatesThem_IsMatched()
    {
        // The remake case, resolved. This is what §M1 means by the year being the most valuable
        // signal after the title, and it only works because the file carried one.
        var result = Resolve(
            "Resident Evil 2", 2019,
            Candidate(1, "Resident Evil 2", 1998),
            Candidate(2, "Resident Evil 2", 2019));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(2, result.GameId);
    }

    // ── what deliberately does not get chosen ───────────────────────────────────────────────

    [Fact]
    public void Resolve_TwoGamesWithOneNameAndNoYearToSeparateThem_IsAmbiguous()
    {
        // The same pair as above with the year taken away. Picking either would be a coin toss
        // written into somebody's library, so both are offered instead — newest first, because the
        // gap to an absent year is unknown and the ids break the tie.
        var result = Resolve(
            "Resident Evil 2", null,
            Candidate(1, "Resident Evil 2", 1998),
            Candidate(2, "Resident Evil 2", 2019));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
        Assert.Null(result.GameId);
        Assert.Equal([1, 2], result.Candidates);
    }

    [Fact]
    public void Resolve_TheOnlyCandidateWhoseYearIsFarFromTheFiles_IsAmbiguous()
    {
        // One exact title, and the file says it is twenty-one years newer. That is not a match with
        // a bad year — it is evidence that IGDB returned the wrong one of two same-named games and
        // the right one was outside the search window. Offered, never chosen.
        var result = Resolve("Resident Evil 2", 2019, Candidate(1, "Resident Evil 2", 1998));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
        Assert.Equal([1], result.Candidates);
    }

    [Fact]
    public void Resolve_ACandidateOnTheYearBoundary_IsStillMatched()
    {
        // A game reaches different territories in different years, and a tracker records the
        // release its user owns. One year of slack is what that costs; two would start admitting
        // the annual sports titles this is most needed for.
        var result = Resolve("Hades", 2020, Candidate(5, "Hades", 2021));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(5, result.GameId);
    }

    [Fact]
    public void Resolve_AnExactTitleBesideAnUndatedOneOfTheSameName_IsAmbiguous()
    {
        // The asymmetry worth pinning: a candidate with no year is never ruled out. Not knowing
        // when a game came out is not evidence against it, so the undated one survives beside the
        // dated one and the row stays somebody's decision. Treating "unknown" as "wrong" would let
        // a missing field in IGDB pick which game a person gets.
        var result = Resolve(
            "Silent Hill", 1999,
            Candidate(1, "Silent Hill", 1999),
            Candidate(2, "Silent Hill"));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
        Assert.Equal([1, 2], result.Candidates);
    }

    [Fact]
    public void Resolve_ASequelWithTheSameNameAsItsOriginal_IsNotEvenOffered()
    {
        // "Dark Souls" and "Dark Souls 3" share nine of their eleven letter pairs, which is well
        // over the similarity floor — a score alone would rank the wrong game first. The numbers in
        // a title are compared as a set of their own for exactly this, and the penalty is heavy
        // enough that a sequel is not a candidate at all rather than a badly ranked one.
        var result = Resolve("Dark Souls", null, Candidate(3, "Dark Souls III", 2016));

        Assert.Equal(ImportMatchKinds.Unmatched, result.Kind);
        Assert.Empty(result.Candidates);
    }

    [Fact]
    public void Resolve_NextYearsSportsTitle_IsNotEvenOffered()
    {
        // The same rule at its most valuable. Two characters apart out of seven, released a year
        // apart, and a wrong answer nobody would notice in a six-hundred-row review.
        var result = Resolve("FIFA 14", 2013, Candidate(9, "FIFA 15", 2014));

        Assert.Equal(ImportMatchKinds.Unmatched, result.Kind);
    }

    [Fact]
    public void Resolve_ADifferentEditionOfTheSameGame_IsOfferedAndNeverChosen()
    {
        // The single most important rule here. "Dark Souls" is plainly worth putting in front of
        // somebody importing "Dark Souls Remastered" — and just as plainly not worth choosing for
        // them, because the two are separate rows in IGDB and only they know which they played.
        var result = Resolve("Dark Souls Remastered", null, Candidate(11, "Dark Souls", 2011));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
        Assert.Null(result.GameId);
        Assert.Equal([11], result.Candidates);
    }

    [Fact]
    public void Resolve_TheEditionItselfBesideTheBaseGame_IsMatchedToTheEdition()
    {
        // And the other half of it: when IGDB does have the edition, the conservative key finds it
        // and the base game drops to an alternative. Nothing about the generous key can outrank an
        // exact one.
        var result = Resolve(
            "Dark Souls Remastered", null,
            Candidate(11, "Dark Souls", 2011),
            Candidate(12, "Dark Souls Remastered", 2018));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(12, result.GameId);
    }

    [Fact]
    public void Resolve_ATitleAndTheSameTitleMisspelled_IsOfferedRatherThanChosen()
    {
        // The floor tolerates a letter out of place, and the review screen is where such a row
        // gets fixed. What must not happen is the fix happening silently.
        //
        // Worth knowing what this does *not* buy, because the constant's name invites the wrong
        // reading: IGDB's search is not fuzzy either, and asking it for "Resedent Evil" returns
        // nothing at all, so in practice a misspelled row has no candidates to score. This pins
        // the scorer's tolerance, not a promise that typos get resolved.
        var result = Resolve("Resedent Evil", null, Candidate(4, "Resident Evil", 1996, 451));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
        Assert.Equal([4], result.Candidates);
    }

    [Fact]
    public void Resolve_ADifferentGameWithASimilarName_IsNotOffered()
    {
        // The other side of the same threshold. "BioShock" and "BioShock Infinite" are different
        // games with most of a name in common, and offering one for the other would train somebody
        // clicking through six hundred rows to stop reading them.
        var result = Resolve("BioShock", 2007, Candidate(6, "BioShock Infinite", 2013));

        Assert.Equal(ImportMatchKinds.Unmatched, result.Kind);
        Assert.Empty(result.Candidates);
    }

    [Fact]
    public void Resolve_NothingLikeTheTitle_IsUnmatched()
    {
        var result = Resolve("Chrono Trigger", 1995, Candidate(8, "Tetris", 1984));

        Assert.Equal(ImportMatchKinds.Unmatched, result.Kind);
        Assert.Null(result.GameId);
        Assert.Empty(result.Candidates);
    }

    [Fact]
    public void Resolve_ATitleThatIsNothingButPunctuation_IsUnmatched()
    {
        // A row that survived parsing with no readable name. Searching for it would ask IGDB an
        // empty question and match against whatever it makes of one, which is worse than saying we
        // cannot read the row.
        var result = Resolve("- ??? -", null, Candidate(1, "Tetris", 1984));

        Assert.Equal(ImportMatchKinds.Unmatched, result.Kind);
        Assert.Empty(result.Candidates);
    }

    [Fact]
    public void Resolve_MoreAlternativesThanTheScreenShows_KeepsTheBest()
    {
        // §M3 offers five. The cap is applied after ranking, so what is cut is always the worst of
        // them — and exact titles score 1 and cannot be cut in favour of a near miss.
        var candidates = Enumerable.Range(1, 8)
            .Select(id => Candidate(id, "Silent Hill", 2000 + id))
            .ToArray();

        var result = Resolve("Silent Hill", null, candidates);

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
        Assert.Equal(ImportMatching.MaxCandidates, result.Candidates.Count);
    }

    [Fact]
    public void Resolve_TheRealGameBeyondTheFifthCandidate_IsStillTheOneChosen()
    {
        // The cap decides what is shown and must not decide what is chosen, so the choice is made
        // over everything that cleared the floor and the cut comes afterwards.
        //
        // Five same-named rows carrying the file's own year, and then the game itself — a year out
        // and with thousands of ratings behind it. The cut orders by year gap, so cutting first
        // drops exactly the row that matters, leaves a forty-rating stub looking unopposed, and
        // answers with it. That is the trap a short ImportMatcher.CandidatePool sets, one layer in:
        // truncation here does not cost a match, it manufactures a wrong one.
        var result = Resolve(
            "Some Game", 2000,
            Candidate(1, "Some Game", 2000, 40),
            Candidate(2, "Some Game", 2000),
            Candidate(3, "Some Game", 2000),
            Candidate(4, "Some Game", 2000),
            Candidate(5, "Some Game", 2000),
            Candidate(6, "Some Game", 2001, 3000));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(6, result.GameId);
    }

    [Fact]
    public void Resolve_NoCandidatesAtAll_IsUnmatched()
    {
        var result = Resolve("Chrono Trigger", 1995);

        Assert.Equal(ImportMatchKinds.Unmatched, result.Kind);
        Assert.Empty(result.Candidates);
    }

    // ── one game, several IGDB rows ─────────────────────────────────────────────────────────

    [Fact]
    public void Resolve_TheReleaseEverybodyTracksBesideItsStubs_IsMatched()
    {
        // Real ids, years and rating counts, read off IGDB while this was written. A search for
        // "Final Fantasy VII" answers with seven entries carrying that exact title — IGDB holds a
        // row per release — so §M2's "exact title, single candidate" resolves nothing at all for
        // the games people actually own. What separates them is that one of the seven has 1,633
        // ratings and the rest have 42, 18, 9 and nothing.
        var result = Resolve(
            "Final Fantasy VII", null,
            Candidate(427, "Final Fantasy VII", 1997, 1633),
            Candidate(207021, "Final Fantasy VII", 1998, 18),
            Candidate(207026, "Final Fantasy VII", 2015, 42),
            Candidate(207028, "Final Fantasy VII", 2015),
            Candidate(393025, "Final Fantasy VII", 1997, 9),
            Candidate(2406, "Final Fantasy VII", 2005),
            Candidate(392808, "Final Fantasy VII", 2012));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(427, result.GameId);
    }

    [Fact]
    public void Resolve_AGameWithOneIgdbRowThatAnyoneTracks_IsMatchedWithNoYearAtAll()
    {
        // Hollow Knight, and the case that makes this rule load-bearing rather than a refinement.
        // Two rows, one of them the most-tracked indie game on the site and the other a 2023 stub
        // nobody has rated. Without a following to compare, a file with no year — which is every
        // Backloggery row — would leave this to be resolved by hand.
        var result = Resolve(
            "Hollow Knight", null,
            Candidate(365702, "Hollow Knight", 2023),
            Candidate(14593, "Hollow Knight", 2017, 2248));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(14593, result.GameId);
    }

    [Fact]
    public void Resolve_ARemakeAndItsOriginalBothWidelyTracked_IsStillAmbiguous()
    {
        // The limit of the same rule, and the reason it is a ratio rather than "pick the biggest".
        // Resident Evil 2's 1998 original and 2019 remake have 604 and 1,440 ratings: both are
        // games people knowingly keep apart, the file says nothing to separate them, and choosing
        // would be inventing an answer. Every stub measured is more than thirty times behind its
        // canonical row; every genuine pair is within four.
        var result = Resolve(
            "Resident Evil 2", null,
            Candidate(880, "Resident Evil 2", 1998, 604),
            Candidate(19686, "Resident Evil 2", 2019, 1440),
            Candidate(217953, "Resident Evil 2", 1998));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);

        // And the list leads with what people track rather than with whichever IGDB numbered first.
        Assert.Equal([19686, 880, 217953], result.Candidates);
    }

    [Fact]
    public void Resolve_ARemakeAndItsOriginalWhenTheFileNamesTheYear_IsMatched()
    {
        // The same three rows with a year in the file. The year rules the remake out, and the two
        // unrated 1998 rows beside the real one are no rivals — so the two rules compose into an
        // answer neither could give alone.
        var result = Resolve(
            "Resident Evil 2", 1998,
            Candidate(880, "Resident Evil 2", 1998, 604),
            Candidate(19686, "Resident Evil 2", 2019, 1440),
            Candidate(217953, "Resident Evil 2", 1998),
            Candidate(287844, "Resident Evil 2", 1999));

        Assert.Equal(ImportMatchKinds.Matched, result.Kind);
        Assert.Equal(880, result.GameId);
    }

    [Fact]
    public void Resolve_TwoObscureRowsOfOneName_IsAmbiguousRatherThanAToss()
    {
        // One rating against none is not evidence. Below the floor the rule withholds itself, and
        // the row goes to the person — which for a game this obscure is the only honest answer.
        var result = Resolve(
            "Some Forgotten Game", null,
            Candidate(1, "Some Forgotten Game", 2011, 2),
            Candidate(2, "Some Forgotten Game", 2012));

        Assert.Equal(ImportMatchKinds.Ambiguous, result.Kind);
    }

    // ── the score itself ────────────────────────────────────────────────────────────────────

    [Fact]
    public void Similarity_IsSymmetricAndBounded()
    {
        Assert.Equal(1, ImportMatching.Similarity("portal 2", "portal 2"));
        Assert.Equal(0, ImportMatching.Similarity("abcd", "wxyz"));

        Assert.Equal(
            ImportMatching.Similarity("resident evil", "resedent evil"),
            ImportMatching.Similarity("resedent evil", "resident evil"));
    }

    [Fact]
    public void Similarity_ARepeatedPairInOneStringOnly_DoesNotCountTwice()
    {
        // Counted as a multiset rather than a set, so a title that repeats a word cannot borrow
        // credit from a candidate that says it once. Set semantics would score these as identical.
        Assert.True(ImportMatching.Similarity("ab ab", "ab") < 1);
    }

    [Fact]
    public void EditionSimilarity_ClearsTheFloorWithoutReachingAnExactMatch()
    {
        // An edition match must always be worth offering and must never be worth choosing. The
        // first half is this floor; the second is that Resolve reads exactness rather than a score,
        // which the "offered and never chosen" test above pins from the outside.
        Assert.True(ImportMatching.EditionSimilarity > ImportMatching.MinimumSimilarity);
        Assert.True(ImportMatching.EditionSimilarity < 1);
    }
}
