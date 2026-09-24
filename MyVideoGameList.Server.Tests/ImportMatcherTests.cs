using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Import;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// How many questions a matching pass asks IGDB, which of them it asks, and what it does with the
/// answers.
/// </summary>
/// <remarks>
/// <c>ImportMatchingTests</c> covers the rule for deciding; this covers everything around it, and
/// almost all of it is about restraint. The matcher stands between a five-thousand-row file and a
/// third party that serves four requests a second, so the tests that matter are the ones saying it
/// asks once per name, stops at its budget, and admits what it did not get to.
/// </remarks>
public class ImportMatcherTests
{
    private static GameDto Game(int id, string title, int? year = null) =>
        new(id, title, null, year is { } value ? new DateOnly(value, 1, 1) : null,
            null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    /// <summary>IGDB, answering each search with whatever <paramref name="answer"/> says.</summary>
    private static IIgdbService IgdbAnswering(Func<string, GameDto[]> answer)
    {
        var igdb = Substitute.For<IIgdbService>();

        igdb.GetGamesAsync(
                Arg.Any<int>(), Arg.Any<int>(), Arg.Any<string?>(),
                Arg.Any<GameBrowseQuery?>(), Arg.Any<CancellationToken>())
            .Returns(call => Task.FromResult(
                new PagedGamesResponse(answer(call.ArgAt<string?>(2) ?? string.Empty), false)));

        return igdb;
    }

    private static ImportMatcher NewMatcher(IIgdbService igdb, IGameCacheService? cache = null) =>
        new(igdb, cache ?? Substitute.For<IGameCacheService>(), NullLogger<ImportMatcher>.Instance);

    /// <summary>The terms IGDB was searched for, in order.</summary>
    private static List<string> SearchedFor(IIgdbService igdb) =>
        igdb.ReceivedCalls()
            .Where(call => call.GetMethodInfo().Name == nameof(IIgdbService.GetGamesAsync))
            .Select(call => (string?)call.GetArguments()[2] ?? string.Empty)
            .ToList();

    [Fact]
    public async Task MatchAsync_TwoRowsNamingOneGame_AsksIgdbOnce()
    {
        // §M5, and the difference between a 500-row import being 500 round trips and being a few
        // dozen. A library exported per platform lists the same game three times, and the three
        // rows are one question — grouped on the normalised key, so spelling does not split them.
        var igdb = IgdbAnswering(_ => [Game(1, "Portal 2", 2011)]);

        var results = await NewMatcher(igdb).MatchAsync([
            new ImportMatchQuery("Portal 2", 2011),
            new ImportMatchQuery("portal 2", 2011),
            new ImportMatchQuery("Portal 2", null),
        ]);

        Assert.Single(SearchedFor(igdb));
        Assert.Equal(3, results.Count);
        Assert.All(results.Values, result => Assert.Equal(ImportMatchKinds.Matched, result.Kind));
    }

    [Fact]
    public async Task MatchAsync_SearchesForWhatTheUserWroteRatherThanTheKeyItMatchesOn()
    {
        // The search term is deliberately not the normalised key. IGDB matches against its own
        // index of its own titles, so sending "legend of zelda ocarina of time" — article dropped,
        // punctuation gone — would be guessing at somebody else's tokeniser on the one call where
        // being wrong costs a candidate that never appears at all.
        var igdb = IgdbAnswering(_ => []);

        await NewMatcher(igdb).MatchAsync([
            new ImportMatchQuery("  The Legend of Zelda:  Ocarina of Time™ ", 1998),
        ]);

        Assert.Equal(["The Legend of Zelda: Ocarina of Time"], SearchedFor(igdb));
    }

    [Fact]
    public async Task MatchAsync_MoreTitlesThanOnePassAllows_LeavesTheRestWithNoAnswerAtAll()
    {
        // The budget, and the shape of admitting it. A title the pass never reached is *absent*
        // from the answer rather than reported unmatched — the caller writes nothing for it, so the
        // next pass picks it up. Answering "nothing found" instead would mark every row of a large
        // import as hopeless in the first five seconds.
        var igdb = IgdbAnswering(term => [Game(term.GetHashCode(), term)]);

        var queries = Enumerable.Range(1, ImportMatcher.MaxLookups + 5)
            .Select(i => new ImportMatchQuery($"Game Number {i}", null))
            .ToList();

        var results = await NewMatcher(igdb).MatchAsync(queries);

        Assert.Equal(ImportMatcher.MaxLookups, SearchedFor(igdb).Count);
        Assert.Equal(ImportMatcher.MaxLookups, results.Count);
        Assert.All(queries.Take(ImportMatcher.MaxLookups), query => Assert.True(results.ContainsKey(query)));
        Assert.All(queries.Skip(ImportMatcher.MaxLookups), query => Assert.False(results.ContainsKey(query)));
    }

    [Fact]
    public async Task MatchAsync_ATitleWithNothingLeftAfterNormalising_IsAnsweredWithoutASearch()
    {
        // The one row that must be answered rather than skipped despite costing no lookup. Skipped,
        // it would be absent from every answer for ever and every future pass would offer it again;
        // searched, it would ask IGDB an empty question and match against the reply.
        var igdb = IgdbAnswering(_ => [Game(1, "Anything")]);
        var query = new ImportMatchQuery("---", null);

        var results = await NewMatcher(igdb).MatchAsync([query]);

        Assert.Empty(SearchedFor(igdb));
        Assert.Equal(ImportMatchKinds.Unmatched, results[query].Kind);
    }

    [Fact]
    public async Task MatchAsync_TheGamesItNames_AreStoredForTheReviewToRender()
    {
        // The review screen reads every game through the cache, so without this the read straight
        // after a pass asks IGDB again for up to a hundred ids that were in hand a moment ago.
        // Only the games a result actually names are stored: a search returns ten and most of them
        // lose, and caching the losers would fill the table with games nobody tracks.
        var igdb = IgdbAnswering(_ => [
            Game(1, "Silent Hill", 1999),
            Game(2, "Silent Hill", 2006),
            Game(3, "Something Else Entirely", 2014),
        ]);

        var cache = Substitute.For<IGameCacheService>();
        List<GameDto> stored = [];
        _ = cache.StoreAsync(
            Arg.Do<IReadOnlyCollection<GameDto>>(games => stored.AddRange(games)),
            Arg.Any<CancellationToken>());

        var results = await NewMatcher(igdb, cache).MatchAsync([new ImportMatchQuery("Silent Hill", null)]);

        Assert.Equal(ImportMatchKinds.Ambiguous, Assert.Single(results.Values).Kind);
        Assert.Equal([1, 2], stored.Select(game => game.Id).Order());
    }

    [Fact]
    public async Task MatchAsync_NothingWorthOffering_StoresNothing()
    {
        var igdb = IgdbAnswering(_ => [Game(3, "Something Else Entirely", 2014)]);
        var cache = Substitute.For<IGameCacheService>();

        await NewMatcher(igdb, cache).MatchAsync([new ImportMatchQuery("Silent Hill", null)]);

        await cache.DidNotReceive().StoreAsync(
            Arg.Any<IReadOnlyCollection<GameDto>>(), Arg.Any<CancellationToken>());
    }

    [Fact]
    public async Task MatchAsync_WhenIgdbIsUnreachable_SaysSoRatherThanSayingNothingMatched()
    {
        // The backend rules forbid swallowing a third party's failure, and this is the case that
        // shows why it is not merely a convention. "Nothing matched" is a sentence somebody acts on
        // by giving up on their import; "IGDB is unreachable" is one they act on by trying later.
        // The exception travels and becomes the 502 UpstreamFailureHandler makes of every such
        // failure (ADR 0034), and because nothing has been written the pass is safe to repeat.
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesAsync(
                Arg.Any<int>(), Arg.Any<int>(), Arg.Any<string?>(),
                Arg.Any<GameBrowseQuery?>(), Arg.Any<CancellationToken>())
            .ThrowsAsync(new HttpRequestException("IGDB is down"));

        await Assert.ThrowsAsync<HttpRequestException>(() =>
            NewMatcher(igdb).MatchAsync([new ImportMatchQuery("Portal 2", 2011)]));
    }

    [Fact]
    public async Task MatchAsync_AskedNothing_AsksIgdbNothing()
    {
        var igdb = IgdbAnswering(_ => [Game(1, "Portal 2", 2011)]);

        Assert.Empty(await NewMatcher(igdb).MatchAsync([]));
        Assert.Empty(SearchedFor(igdb));
    }
}
