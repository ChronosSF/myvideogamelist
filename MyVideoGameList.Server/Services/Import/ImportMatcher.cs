using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Import;

/// <inheritdoc cref="IImportMatcher"/>
internal sealed class ImportMatcher(
    IIgdbService igdb,
    IGameCacheService gameCache,
    ILogger<ImportMatcher> logger) : IImportMatcher
{
    /// <summary>
    /// How many distinct titles one pass asks IGDB about.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IGDB's pipeline paces calls at four a second (ADR 0034), so twenty searches is about five
    /// seconds in the worst case and a good deal less once the thirty-minute response cache starts
    /// answering. That is a request somebody will sit through; a hundred is not, and five thousand
    /// is the background job <c>specs/csv-list-import.md</c> §S5 wanted.
    /// </para>
    /// <para>
    /// A bound is what makes the queue unnecessary rather than merely deferred. Each pass is one
    /// ordinary authenticated request that either succeeds whole or writes nothing, the caller runs
    /// it again for the next batch, and a person who closes the tab has lost nothing but the rows
    /// still unlooked-at — which is exactly the resumability §C4 asks for, out of no machinery at
    /// all. ADR 0038's one scheduled service stays one.
    /// </para>
    /// </remarks>
    internal const int MaxLookups = 20;

    /// <summary>
    /// How many of IGDB's answers for one search are considered.
    /// </summary>
    /// <remarks>
    /// <para>
    /// IGDB orders a search by its own relevance and <c>ImportMatching</c> re-ranks what comes back,
    /// so this is the window the right answer has to fall inside. <b>Too small a window does not
    /// cost a match — it manufactures a wrong one</b>, and that is why it is twenty rather than the
    /// handful the review screen shows. A search for "Resident Evil" puts the 1996 original at
    /// position thirteen, behind six bundles and four re-releases; asked for ten results the
    /// matcher sees only the 2002 remake and its unrated neighbours, finds it dominant, and writes
    /// a game nobody played into a library without asking. Asked for twenty it sees the original
    /// too, finds two comparable releases, and asks. "Doom" and "The Legend of Zelda: Ocarina of
    /// Time" — whose canonical rows sit at fourteen and six — go the same way.
    /// </para>
    /// <para>
    /// Twenty is also the page the browse listing already asks IGDB for, so a search here costs
    /// what a page of search results costs on the site.
    /// </para>
    /// </remarks>
    internal const int CandidatePool = 20;

    public async Task<IReadOnlyDictionary<ImportMatchQuery, ImportMatchResult>> MatchAsync(
        IReadOnlyCollection<ImportMatchQuery> queries, CancellationToken cancellationToken = default)
    {
        var results = new Dictionary<ImportMatchQuery, ImportMatchResult>();

        // Nothing left after normalising — a title of punctuation, or of a script that reduces to
        // nothing. Answered without a search rather than skipped: an absent answer means "not
        // looked at yet" and would have the caller offer this row to every future pass for ever.
        var asked = queries.Select(query => (Query: query, Key: ImportTitle.Normalise(query.Title))).ToList();

        foreach (var (query, _) in asked.Where(pair => pair.Key.Length == 0))
            results[query] = ImportMatching.Resolve(query, []);

        // One search per distinct name, in the order the rows arrived, and no more than the budget
        // allows. Names past it are left out of the answer entirely, which is how the caller knows
        // to ask again rather than recording "nothing matched" for a row nobody looked up.
        var lookups = asked
            .Where(pair => pair.Key.Length > 0)
            .GroupBy(pair => pair.Key, StringComparer.Ordinal)
            .Take(MaxLookups)
            .ToList();

        // The games this pass is about to be asked to render. The review screen reads every game
        // through IGameCacheService, so without warming it the read straight after a match would
        // ask IGDB again for ids that were in hand a moment ago.
        var warming = new Dictionary<int, GameDto>();

        foreach (var sharing in lookups)
        {
            // The first spelling seen wins the search term. They share a normalised key, so they
            // differ only in case, punctuation or an article — none of which IGDB's search cares
            // about.
            var found = await SearchAsync(ImportTitle.Tidy(sharing.First().Query.Title), cancellationToken);
            var games = found.ToDictionary(game => game.Id);

            var pool = found
                .Select(game => new ImportCandidate(
                    game.Id, game.Title, game.ReleaseDate?.Year, game.RatingCount))
                .ToList();

            foreach (var (query, _) in sharing)
            {
                var result = ImportMatching.Resolve(query, pool);
                results[query] = result;

                // Only the games a result actually named, gathered as they are decided. A search
                // returns twenty and most of them lose; caching the losers would fill the table
                // with games nobody tracks.
                if (result.GameId is { } matched) warming.TryAdd(matched, games[matched]);
                foreach (var candidate in result.Candidates) warming.TryAdd(candidate, games[candidate]);
            }
        }

        if (warming.Count > 0) await gameCache.StoreAsync(warming.Values.ToList(), cancellationToken);

        // At Information because it is the only record of what a matching pass did: the rows carry
        // the outcome but not that this pass produced it, and a preset whose titles resolve badly
        // will show up here as passes that answer everything and match nothing.
        logger.LogInformation(
            "Matched {Answered} of {Asked} import rows from {Lookups} searches: "
            + "{Matched} resolved, {Ambiguous} left to choose",
            results.Count,
            queries.Count,
            lookups.Count,
            results.Values.Count(result => result.Kind == ImportMatchKinds.Matched),
            results.Values.Count(result => result.Kind == ImportMatchKinds.Ambiguous));

        return results;
    }

    /// <summary>
    /// One search, through the same path browse and the search page use.
    /// </summary>
    /// <remarks>
    /// No browse query, and that is not an omission. Its platform, genre, year and score filters
    /// <em>do</em> apply to a search, and every one of them would be wrong here: a library being
    /// imported is full of games no critic scored and no platform filter should narrow. (Its
    /// <c>sort</c> and that order's floors are the part a search never sees — IGDB answers a search
    /// carrying a sort with a 406, so <c>BuildQuery</c> skips both, ADR 0032.)
    /// </remarks>
    private async Task<IReadOnlyList<GameDto>> SearchAsync(string term, CancellationToken cancellationToken)
    {
        var page = await igdb.GetGamesAsync(
            offset: 0, limit: CandidatePool, search: term, browse: null, cancellationToken: cancellationToken);

        return page.Items.ToList();
    }
}
