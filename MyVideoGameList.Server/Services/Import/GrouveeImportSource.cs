using System.Globalization;
using System.Text.Json;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Reads a Grouvee account export — the JSON form or the CSV one, which carry identical data.
/// </summary>
/// <remarks>
/// <para>
/// The first preset, and the one the design was worked out against. Grouvee is unusually good to
/// import from for a reason that is easy to miss: it stores <b>IGDB's own game id</b> and exports
/// it, on 606 of the 608 rows in the export this was built from. So there is no fuzzy matching on
/// this path at all (ADR 0037, decision 2).
/// </para>
/// <para>
/// Three traps in the file, all of which produce plausible wrong answers rather than errors:
/// </para>
/// <list type="bullet">
/// <item>
/// Absent dates are the <b>string <c>"None"</c></b> rather than JSON null — a <c>str(None)</c> leak
/// from their exporter. Parsed naively it is a non-empty value that is not a date.
/// </item>
/// <item>
/// <c>seconds_played</c> is <b>0</b> rather than absent when unrecorded, which must not become a
/// zero-minute run.
/// </item>
/// <item>
/// <c>level_of_completion</c> is a <b>default</b>, not a statement — see
/// <see cref="ImportPlaythroughPayload"/> for why it is therefore read and discarded.
/// </item>
/// </list>
/// </remarks>
internal sealed class GrouveeImportSource : IImportSource
{
    public string Key => ImportSources.Grouvee;

    /// <summary>
    /// The export format this code was written against. A major bump is refused rather than
    /// guessed at: a renamed field would deserialise to null and import a library with its scores
    /// and dates quietly missing.
    /// </summary>
    internal const int SupportedFormatVersion = 2;

    /// <summary>
    /// Grouvee's three built-in shelves, plus the wishlist. Anything else is a shelf the user made
    /// up, which the review screen asks them about rather than guessing at.
    /// </summary>
    private const string ShelfPlayed = "played";
    private const string ShelfPlaying = "playing";
    private const string ShelfBacklog = "backlog";
    private const string ShelfWishList = "wish list";

    public bool CanRead(string fileName, ReadOnlySpan<char> head) =>
        head.Contains("grouvee", StringComparison.OrdinalIgnoreCase)
        || head.Contains("date_added_to_collection", StringComparison.Ordinal)
        || fileName.Contains("grouvee", StringComparison.OrdinalIgnoreCase);

    public IReadOnlyList<ImportRowPayload> Read(string content)
    {
        var document = content.TrimStart().StartsWith('{')
            ? ReadJson(content)
            : GrouveeCsv.Read(content);

        return Map(document);
    }

    private static GrouveeExport ReadJson(string content)
    {
        GrouveeExport? export;
        try
        {
            export = JsonSerializer.Deserialize<GrouveeExport>(content, GrouveeJson.Options);
        }
        catch (JsonException e)
        {
            throw new ImportParseException($"That file is not valid JSON ({e.Message}).");
        }

        if (export is null || export.Collection is null)
            throw new ImportParseException("That file does not look like a Grouvee export.");

        // Read before anything is mapped, so an unreadable version fails as a version rather than
        // as a library that came out empty.
        if (export.ExportFormatVersion > SupportedFormatVersion)
            throw new ImportParseException(
                $"This is Grouvee export format {export.ExportFormatVersion}, and MyVideoGameList "
                + $"understands up to {SupportedFormatVersion}. Please report it — the file is fine, we are behind.");

        return export;
    }

    /// <summary>
    /// The whole mapping: the collection, then anything the other two sections know about that the
    /// collection does not.
    /// </summary>
    /// <remarks>
    /// <c>play_log</c> and <c>reviews</c> are mostly a second view of data already in
    /// <c>collection</c>, but not entirely — in the export this was built from they carried 8 and 2
    /// games respectively that the collection did not, presumably unshelved with their history kept.
    /// Those are real records of playing and scoring a game, so they become status-less entries
    /// (ADR 0019) rather than being dropped on the floor.
    /// </remarks>
    private static List<ImportRowPayload> Map(GrouveeExport export)
    {
        var favourites = FavouriteIds(export);
        var rows = new List<ImportRowPayload>();

        // Keyed by IGDB id where there is one, so the later sections can find a game the collection
        // already produced. A row with no id cannot be matched up this way and simply stands alone.
        var byGameId = new Dictionary<int, int>();

        foreach (var game in export.Collection!)
        {
            var row = MapCollectionEntry(game, favourites);
            if (row is null) continue;

            if (row.GameId is { } id) byGameId.TryAdd(id, rows.Count);
            rows.Add(row);
        }

        MergeOrphans(export, favourites, rows, byGameId);
        return rows;
    }

    private static ImportRowPayload? MapCollectionEntry(GrouveeGame game, IReadOnlySet<int> favourites)
    {
        var title = Clean(game.Name);
        if (title is null) return null;

        var shelves = game.Shelves?.Keys.ToList() ?? [];
        var playthroughs = MapPlaythroughs(game.Dates, game.Platforms?.Keys.FirstOrDefault());
        var finished = playthroughs.Any(p => p.FinishedOn is not null);
        var (status, unrecognised) = MapShelves(shelves, finished);

        return new ImportRowPayload(
            Title: title,
            SourceRef: game.Id > 0 ? game.Id.ToString(CultureInfo.InvariantCulture) : null,
            ReleaseYear: YearOf(game.ReleaseDate),
            GameId: game.IgdbId,
            SourceStatus: shelves.Count > 0 ? string.Join(", ", shelves) : null,
            Status: status,
            StatusUnrecognised: unrecognised,
            Score: MapRating(game.Rating),
            Wishlist: shelves.Any(IsWishlistShelf),
            Favourite: game.IgdbId is { } id && favourites.Contains(id),
            Notes: MapNotes(game.ReviewTitle, game.Review),
            AddedAt: TimestampOf(game.DateAddedToCollection),
            Playthroughs: playthroughs);
    }

    /// <summary>
    /// Games that appear only in <c>play_log</c> or <c>reviews</c>, folded in as status-less
    /// entries carrying whatever those sections know.
    /// </summary>
    private static void MergeOrphans(
        GrouveeExport export,
        IReadOnlySet<int> favourites,
        List<ImportRowPayload> rows,
        Dictionary<int, int> byGameId)
    {
        foreach (var play in export.PlayLog ?? [])
        {
            var (index, title) = Locate(play.Game, rows, byGameId);
            if (title is null) continue;

            var run = MapPlaythrough(play, fallbackPlatform: null);
            if (run is null) continue;

            // Deduplicated by the run's own fields rather than by whether the row already has one.
            // The play log is mostly a second view of the collection's `dates`, so the same run
            // does arrive twice — but a game can have several genuinely different runs, and
            // "the row already has a playthrough" would throw every one after the first away.
            if (index is { } at)
            {
                rows[at] = rows[at] with { Playthroughs = Merge(rows[at].Playthroughs, run) };
                continue;
            }

            rows.Add(NewOrphan(title, play.Game, favourites) with { Playthroughs = [run] });
            Remember(rows, byGameId);
        }

        foreach (var review in export.Reviews ?? [])
        {
            var (index, title) = Locate(review.Game, rows, byGameId);
            if (title is null || index is not null) continue;

            rows.Add(NewOrphan(title, review.Game, favourites) with
            {
                Score = MapRating(review.Rating),
                Notes = MapNotes(review.Title, review.Text)
            });
            Remember(rows, byGameId);
        }
    }

    /// <summary>
    /// The runs plus this one, unless it is one of them already.
    /// </summary>
    /// <remarks>
    /// Equality is the dates and the duration, not the platform: the collection's copy of a run
    /// carries the game's platform as a fallback and the play log's copy carries only what the run
    /// itself recorded, so comparing it would make two views of one run look like two runs.
    /// </remarks>
    private static IReadOnlyList<ImportPlaythroughPayload> Merge(
        IReadOnlyList<ImportPlaythroughPayload> runs, ImportPlaythroughPayload run)
    {
        var already = runs.Any(existing =>
            existing.StartedOn == run.StartedOn
            && existing.FinishedOn == run.FinishedOn
            && existing.MinutesPlayed == run.MinutesPlayed);

        return already ? runs : [.. runs, run];
    }

    private static (int? Index, string? Title) Locate(
        GrouveeGameRef? game, List<ImportRowPayload> rows, Dictionary<int, int> byGameId)
    {
        var title = Clean(game?.Name);
        if (game is null || title is null) return (null, null);

        if (game.IgdbId is { } id && byGameId.TryGetValue(id, out var at)) return (at, title);

        // No id to match on, so fall back to the title. Exact rather than fuzzy: this is only
        // deduplicating one file against itself, where the same game is spelled the same way.
        var found = rows.FindIndex(r => r.GameId is null
            && string.Equals(r.Title, title, StringComparison.OrdinalIgnoreCase));

        return (found >= 0 ? found : null, title);
    }

    private static ImportRowPayload NewOrphan(string title, GrouveeGameRef? game, IReadOnlySet<int> favourites) =>
        new(
            Title: title,
            // The play log and the reviews point at a game by name and IGDB id, never by the
            // collection row's own id, so a row that exists only there has no source reference.
            SourceRef: null,
            ReleaseYear: null,
            GameId: game?.IgdbId,
            // On no shelf at all, which is not an unrecognised shelf: it is a game the user has
            // data about and is not tracking, which is exactly what a null status means.
            SourceStatus: null,
            Status: null,
            StatusUnrecognised: false,
            Score: null,
            Wishlist: false,
            Favourite: game?.IgdbId is { } id && favourites.Contains(id),
            Notes: null,
            AddedAt: null,
            Playthroughs: []);

    private static void Remember(List<ImportRowPayload> rows, Dictionary<int, int> byGameId)
    {
        if (rows[^1].GameId is { } id) byGameId.TryAdd(id, rows.Count - 1);
    }

    /// <summary>
    /// Grouvee's shelves onto our statuses, per ADR 0037 decision 3.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The interesting case is <c>Played</c>, which in Grouvee means "I have played this" and
    /// nothing more — it has no Finished, no Dropped and no On Hold. A user-entered finish date is
    /// a statement that the game was finished, so a Played row carrying one becomes Finished. One
    /// without stays <b>status-less</b>: that is ADR 0026's ambiguous bucket, and guessing at it is
    /// what 0026 exists to refuse. In the export this was built from it is 448 of 608 rows.
    /// </para>
    /// <para>
    /// Precedence matters when a game sits on several shelves, which Grouvee permits: current state
    /// wins, so Playing beats Played beats Backlog. A game on Played and Playing is one somebody is
    /// replaying, and Playing is the truer answer about now.
    /// </para>
    /// </remarks>
    private static (string? Status, bool Unrecognised) MapShelves(
        IReadOnlyList<string> shelves, bool finished)
    {
        if (shelves.Count == 0) return (null, false);

        if (shelves.Any(s => Is(s, ShelfPlaying))) return (ListStatusKeys.Playing, false);
        if (shelves.Any(s => Is(s, ShelfPlayed))) return (finished ? ListStatusKeys.Finished : null, false);
        if (shelves.Any(s => Is(s, ShelfBacklog))) return (ListStatusKeys.Backlog, false);

        // The wishlist is an axis rather than a status (ADR 0022), so a game only wishlisted has no
        // status and nothing was misunderstood.
        if (shelves.All(IsWishlistShelf)) return (null, false);

        // A shelf the user invented. Never defaulted to Backlog — the review screen asks.
        return (null, true);
    }

    private static bool IsWishlistShelf(string shelf) => Is(shelf, ShelfWishList);

    private static bool Is(string shelf, string known) =>
        shelf.Trim().Equals(known, StringComparison.OrdinalIgnoreCase);

    private static IReadOnlyList<ImportPlaythroughPayload> MapPlaythroughs(
        IReadOnlyList<GrouveePlay>? plays, string? fallbackPlatform) =>
        (plays ?? [])
            .Select(p => MapPlaythrough(p, fallbackPlatform))
            .OfType<ImportPlaythroughPayload>()
            .ToList();

    /// <summary>
    /// One play-log row, or null when it records nothing at all.
    /// </summary>
    /// <remarks>
    /// Grouvee writes a play-log row with every field empty whenever a game is shelved, so most
    /// rows in a real export say nothing. Those produce no playthrough rather than an empty one:
    /// a run with no date, no duration and no platform is not a run somebody had.
    /// </remarks>
    private static ImportPlaythroughPayload? MapPlaythrough(GrouveePlay play, string? fallbackPlatform)
    {
        var started = DateOf(play.DateStarted);
        var finished = DateOf(play.DateFinished);
        var platform = Clean(play.Platform) ?? fallbackPlatform;

        // Zero is Grouvee's "not recorded", not a duration. Rounded up, so a run of under a minute
        // is a minute rather than disappearing into the same null.
        var minutes = play.SecondsPlayed > 0
            ? (int?)Math.Max(1, (int)Math.Round(play.SecondsPlayed / 60d))
            : null;

        if (started is null && finished is null && minutes is null) return null;

        // The column's check constraint refuses it, and a run that finished before it started is
        // bad data rather than a reason to fail somebody's whole import.
        if (started is not null && finished is not null && finished < started)
            started = null;

        return new ImportPlaythroughPayload(started, finished, minutes, platform);
    }

    /// <summary>Grouvee's five stars onto our ten points. A clean doubling, and the same scale.</summary>
    private static short? MapRating(decimal? rating)
    {
        if (rating is not { } value || value <= 0) return null;

        var scaled = (short)Math.Round(value * 2, MidpointRounding.AwayFromZero);
        return Math.Clamp(scaled, (short)1, (short)10);
    }

    /// <summary>
    /// The review title and body as one note. Lands on the entry's private notes rather than
    /// creating a <c>Review</c>, which is somebody's to publish rather than ours (ADR 0037).
    /// </summary>
    private static string? MapNotes(string? title, string? body)
    {
        var cleanTitle = Clean(title);
        var cleanBody = Clean(body);

        if (cleanTitle is null) return cleanBody;
        return cleanBody is null ? cleanTitle : $"{cleanTitle}\n\n{cleanBody}";
    }

    /// <summary>
    /// A Grouvee date, which is <c>null</c>, empty, or the <em>string</em> <c>"None"</c> when there
    /// is not one. The third is the trap: it is a non-empty value that is not a date.
    /// </summary>
    internal static DateOnly? DateOf(string? value) =>
        Clean(value) is { } text
        && !text.Equals("None", StringComparison.OrdinalIgnoreCase)
        && DateOnly.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)
            ? date
            : null;

    private static int? YearOf(string? value) => DateOf(value)?.Year;

    /// <summary>
    /// A Grouvee calendar date as the instant the entry records being added.
    /// </summary>
    /// <remarks>
    /// <c>date_added_to_collection</c> is a date with no time, so this is midnight UTC on it. The
    /// alternative is the shelf's own <c>date_added</c>, which does carry a time — but a game can
    /// be on several shelves with several of them, and "which shelf did they add it to first" is a
    /// question this import does not otherwise have to answer. A day's precision is enough for
    /// what the value is for, which is keeping "recently added" in the order the user remembers.
    /// </remarks>
    private static DateTimeOffset? TimestampOf(string? value) =>
        DateOf(value) is { } date ? new DateTimeOffset(date, TimeOnly.MinValue, TimeSpan.Zero) : null;

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// The account's favourite games, read defensively.
    /// </summary>
    /// <remarks>
    /// <c>favorite_games</c> was <b>empty</b> in the only real export this was built from, so its
    /// element shape is inferred from the two game references that do appear in the document rather
    /// than observed. It is therefore best-effort by design: anything that does not look like a
    /// game reference with an IGDB id is ignored, and nothing here can fail an import. If it turns
    /// out to be shaped otherwise, the cost is that favourites are not imported — not a bad import.
    /// </remarks>
    private static IReadOnlySet<int> FavouriteIds(GrouveeExport export)
    {
        var ids = new HashSet<int>();
        foreach (var element in export.Account?.FavoriteGames ?? [])
        {
            switch (element.ValueKind)
            {
                case JsonValueKind.Number when element.TryGetInt32(out var direct):
                    ids.Add(direct);
                    break;
                case JsonValueKind.Object
                    when element.TryGetProperty("igdb_id", out var nested) && nested.TryGetInt32(out var id):
                    ids.Add(id);
                    break;
            }
        }

        return ids;
    }
}
