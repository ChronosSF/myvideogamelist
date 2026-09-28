namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// One row's title, as the file spelled it, and the year the file gave for it.
/// </summary>
/// <remarks>
/// A record rather than two arguments because it is also the key the answers come back under: two
/// rows naming the same game are one question, which is what stops a five-hundred-row import being
/// five hundred round trips (<c>specs/csv-list-import.md</c> §M5).
/// </remarks>
/// <param name="ReleaseYear">
/// Null is ordinary — Backloggery's export has no year at all — and it costs precision rather than
/// a match: the year is what separates a remake from the game it remakes, so without one two
/// same-named games can only be offered, never chosen between.
/// </param>
public sealed record ImportMatchQuery(string Title, int? ReleaseYear);

/// <summary>
/// What the matcher made of one query.
/// </summary>
/// <param name="Kind">One of <c>ImportMatchKinds</c>.</param>
/// <param name="GameId">The IGDB game, set only for <c>matched</c>.</param>
/// <param name="Candidates">
/// The games worth offering, best first, for <c>ambiguous</c>. Empty for the other two kinds — a
/// matched row needs no alternatives and an unmatched one has none.
/// </param>
public sealed record ImportMatchResult(string Kind, int? GameId, IReadOnlyList<int> Candidates);

/// <summary>
/// Turning titles into IGDB ids, for the rows whose source did not carry one.
/// </summary>
/// <remarks>
/// <para>
/// The <c>specs/csv-list-import.md</c> §M1–M3 matcher. It was deliberately not built with the first
/// preset, because Grouvee's export carries <c>igdb_id</c> on 606 of 608 rows and a matcher would
/// have been the hard half of the feature written against no working whole (ADR 0037, decision 2).
/// It is built now, ahead of the sources that have no ids, and against the path that already works:
/// the handful of Grouvee rows with no id go through it exactly as every Backloggery row will.
/// </para>
/// <para>
/// <b>Bounded, and honest about being bounded.</b> One call looks up at most
/// <c>ImportMatcher.MaxLookups</c> distinct titles, because IGDB's pipeline paces requests at four
/// a second and a person is waiting on the other end. Queries it did not get to are simply absent
/// from the answer rather than reported as unmatched — the difference between "we looked and found
/// nothing" and "we have not looked yet" is what lets the caller run the pass again and make
/// progress instead of relabelling the same rows for ever.
/// </para>
/// <para>
/// IGDB failures are <b>not</b> swallowed. A matcher that answered "nothing matched" during an
/// outage would be telling somebody their library is unrecognisable when it is merely unreachable,
/// and they would act on it by giving up; so the exception travels and becomes the 502 that
/// <c>UpstreamFailureHandler</c> turns every third-party failure into (ADR 0034). Nothing is
/// written when that happens, and a pass is safe to repeat.
/// </para>
/// </remarks>
public interface IImportMatcher
{
    /// <summary>
    /// Resolves as many of these queries as one pass allows.
    /// </summary>
    /// <returns>
    /// An answer for each query that was looked up. A query absent from the dictionary was not
    /// attempted, and asking again is how it gets attempted.
    /// </returns>
    Task<IReadOnlyDictionary<ImportMatchQuery, ImportMatchResult>> MatchAsync(
        IReadOnlyCollection<ImportMatchQuery> queries, CancellationToken cancellationToken = default);
}
