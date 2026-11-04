using System.Text.Json;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services.Import;

/// <summary>
/// Reads this site's own data export — the document <c>GET /api/user/export</c> saves — back in as
/// an import.
/// </summary>
/// <remarks>
/// <para>
/// <b>A tracker export like any other, on purpose.</b> Everything after the seam is the shared
/// import, so every rule it applies to Grouvee applies here, and the round trip is not perfect and
/// is not meant to be (ADR 0083). What comes back is what the canonical row carries: the list, the
/// score, the notes, the date the game was added, the wishlist and favourite marks, and each run's
/// dates, minutes and type. What does not is everything the row has no field for — the event log,
/// when a score was given or a status changed, ownership, the hand-arranged orders, tags, list names,
/// settings, and a run's platform and notes. A review comes back appended to the notes and never as
/// a review, because putting somebody's prose in front of other people is not an import's decision
/// (ADR 0037).
/// </para>
/// <para>
/// <b>Nothing in the file is trusted for having come from here.</b> It is a file its owner holds
/// and can edit, so every value the database checks is checked first and dropped on its own when it
/// fails — a score out of range, a run finishing before it started, a duration of no minutes —
/// rather than left to fail the whole commit on its final save, as Grouvee's bad dates are.
/// </para>
/// <para>
/// <b>Every row comes out with an empty title.</b> The export names a game by its IGDB id and
/// nothing else (ADR 0024), and this reader touches no database, so the upload names these rows from
/// the local cache instead (<c>ImportService</c>).
/// </para>
/// <para>
/// The sections are read into the same records the exporter writes, so renaming a property renames
/// it for both. What that cannot catch is a file saved before the rename, whose old name would read
/// as null; <c>ExportRoundTripTests</c> pins what an export of today's shape brings back.
/// </para>
/// </remarks>
internal sealed class MyVideoGameListImportSource : IImportSource
{
    public string Key => ImportSources.MyVideoGameList;

    /// <summary>
    /// How the export is written: ASP.NET Core's web defaults, which are camel case. One instance,
    /// for the reason <see cref="GrouveeJson"/> gives.
    /// </summary>
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web);

    /// <summary>The five lists. A key added later is unrecognised here until named, which asks.</summary>
    private static readonly HashSet<string> StatusKeys =
    [
        ListStatusKeys.Backlog,
        ListStatusKeys.Playing,
        ListStatusKeys.OnHold,
        ListStatusKeys.Finished,
        ListStatusKeys.Dropped
    ];

    private static readonly HashSet<string> TypeKeys =
    [
        PlaythroughTypeKeys.Rushed,
        PlaythroughTypeKeys.Normally,
        PlaythroughTypeKeys.Completionist
    ];

    /// <summary>
    /// <c>CK_UserGamePlaythroughs_MinutesPlayed_Range</c>'s upper bound, which a run's duration is
    /// held to here so that a hand-edited figure costs the run its minutes rather than the import.
    /// </summary>
    private const int MaxMinutes = 600_000;

    /// <summary>
    /// The first two properties of every export, in the order the document writes them. Both,
    /// because Grouvee's is snake case and another tracker's camel-case export might carry either one.
    /// </summary>
    public bool CanRead(string fileName, ReadOnlySpan<char> head) =>
        head.Contains("\"exportedAt\"", StringComparison.Ordinal)
        && head.Contains("\"account\"", StringComparison.Ordinal);

    public IReadOnlyList<ImportRowPayload> Read(string content)
    {
        Export? export;
        try
        {
            export = JsonSerializer.Deserialize<Export>(content, Options);
        }
        catch (JsonException e)
        {
            throw new ImportParseException($"That file could not be read as a MyVideoGameList export ({e.Message}).");
        }

        // Every section of an export is always present, empty or not (UserDataExportDto), so a
        // document without the entries is not one of ours rather than one with nothing in it.
        if (export?.ExportedAt is null || export.Entries is null)
            throw new ImportParseException("That file does not look like a MyVideoGameList export.");

        return Map(export);
    }

    /// <summary>
    /// One row per game: the entries in the order the export lists them, oldest first, then any game
    /// that only the wishlist, the favourites, a run or a review names.
    /// </summary>
    /// <remarks>
    /// The last two cannot happen in a document this site wrote, since a run and a review hang off
    /// an entry, but can in one somebody edited. Such a game becomes a row in no list, carrying what
    /// was said about it, as a Grouvee game known only to its play log does.
    /// </remarks>
    private static List<ImportRowPayload> Map(Export export)
    {
        var order = new List<int>();
        var seen = new HashSet<int>();

        void Note(int gameId)
        {
            if (seen.Add(gameId)) order.Add(gameId);
        }

        var entries = new Dictionary<int, EntryExportDto>();
        foreach (var entry in Valid(export.Entries, e => e.GameId))
            if (entries.TryAdd(entry.GameId, entry)) Note(entry.GameId);

        var wishlist = FirstDates(Valid(export.Wishlist, w => w.GameId), w => w.GameId, w => w.AddedAt);
        var favourites = FirstDates(Valid(export.Favourites, f => f.GameId), f => f.GameId, f => f.AddedAt);

        var runs = Valid(export.Playthroughs, p => p.GameId)
            .GroupBy(p => p.GameId)
            .ToDictionary(g => g.Key, g => g.Select(MapRun).ToList());

        var reviews = Valid(export.Reviews, r => r.GameId)
            .GroupBy(r => r.GameId)
            .ToDictionary(g => g.Key, g => g.Select(r => Clean(r.Body)).OfType<string>().ToList());

        foreach (var gameId in wishlist.Keys.Concat(favourites.Keys).Concat(runs.Keys).Concat(reviews.Keys))
            Note(gameId);

        return order
            .Select(gameId =>
            {
                var entry = entries.GetValueOrDefault(gameId);
                var (status, unrecognised) = MapStatus(entry?.Status);

                return new ImportRowPayload(
                    Title: string.Empty,
                    SourceRef: null,
                    ReleaseYear: null,
                    GameId: gameId,
                    SourceStatus: Clean(entry?.Status),
                    Status: status,
                    StatusUnrecognised: unrecognised,

                    // Our lists say how a game ended, or that it has not; there is no played-and-
                    // unresolved shelf here for the review to ask about.
                    PlayedUnresolved: false,
                    Score: entry?.Score is >= 1 and <= 10 and var score ? (short)score : null,
                    Wishlist: wishlist.ContainsKey(gameId),
                    Favourite: favourites.ContainsKey(gameId),
                    Notes: MapNotes(entry?.Notes, reviews.GetValueOrDefault(gameId)),
                    AddedAt: AddedAt(entry, wishlist.GetValueOrDefault(gameId), favourites.GetValueOrDefault(gameId)),
                    Playthroughs: runs.GetValueOrDefault(gameId) ?? []);
            })
            .ToList();
    }

    /// <summary>The items of a section that are there and name a game, dropping a null or an id of nothing.</summary>
    private static IEnumerable<T> Valid<T>(IReadOnlyList<T?>? section, Func<T, int> gameId) where T : class =>
        (section ?? []).OfType<T>().Where(item => gameId(item) > 0);

    /// <summary>When each game joined an axis, the first mention winning if a game is named twice.</summary>
    private static Dictionary<int, DateTimeOffset?> FirstDates<T>(
        IEnumerable<T> items, Func<T, int> gameId, Func<T, DateTimeOffset> addedAt)
    {
        var dates = new Dictionary<int, DateTimeOffset?>();
        foreach (var item in items) dates.TryAdd(gameId(item), Instant(addedAt(item)));
        return dates;
    }

    /// <summary>
    /// The status key if it is one of ours, and whether it was something else. A null status is a
    /// game in no list (ADR 0019), which is an answer rather than something unrecognised.
    /// </summary>
    private static (string? Status, bool Unrecognised) MapStatus(string? key) =>
        Clean(key) switch
        {
            null => (null, false),
            var known when StatusKeys.Contains(known) => (known, false),
            _ => (null, true)
        };

    /// <summary>
    /// The one date the row has, which the commit gives the entry and both axes alike: the entry's
    /// own when there is one, otherwise the earlier of the two marks.
    /// </summary>
    private static DateTimeOffset? AddedAt(
        EntryExportDto? entry, DateTimeOffset? wishlisted, DateTimeOffset? favourited) =>
        Instant(entry?.AddedAt) ?? (wishlisted, favourited) switch
        {
            ({ } wished, { } favoured) => wished < favoured ? wished : favoured,
            ({ } wished, null) => wished,
            (null, var favoured) => favoured
        };

    /// <summary>
    /// A date the file actually gave. A property missing from an edited file reads as the type's
    /// default, the year 1, which is not a date anybody added a game on.
    /// </summary>
    private static DateTimeOffset? Instant(DateTimeOffset? value) =>
        value is { } instant && instant != default ? instant : null;

    /// <summary>
    /// The private notes, then the review's text after them, as one note. The spoiler mark and the
    /// review's visibility have nowhere to go and are left behind with it.
    /// </summary>
    private static string? MapNotes(string? notes, IReadOnlyList<string>? reviews)
    {
        var parts = new List<string>();
        if (Clean(notes) is { } own) parts.Add(own);
        parts.AddRange(reviews ?? []);

        return parts.Count == 0 ? null : string.Join("\n\n", parts);
    }

    /// <summary>
    /// One run, held to the database's checks: a duration outside them is dropped, and a finish
    /// before the start drops the start, as a Grouvee run's does. Its platform and its notes have no
    /// field in the canonical row and stay behind.
    /// </summary>
    private static ImportPlaythroughPayload MapRun(PlaythroughExportDto run)
    {
        var started = run.StartedOn;
        if (started is not null && run.FinishedOn is not null && run.FinishedOn < started) started = null;

        return new ImportPlaythroughPayload(
            StartedOn: started,
            FinishedOn: run.FinishedOn,
            MinutesPlayed: run.MinutesPlayed is >= 1 and <= MaxMinutes ? run.MinutesPlayed : null,
            PlatformName: null,
            Type: Clean(run.Type) is { } type && TypeKeys.Contains(type) ? type : null);
    }

    private static string? Clean(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    /// <summary>
    /// The sections of the export this reads, and nothing it does not: the account, the event log,
    /// the tags, the list names and sort orders and the past imports are not read at all.
    /// </summary>
    /// <remarks>
    /// Every member nullable, items included, because a hand-edited file can leave any of them out
    /// and a missing one has to read as missing rather than as a crash.
    /// </remarks>
    private sealed record Export(
        DateTimeOffset? ExportedAt,
        IReadOnlyList<EntryExportDto?>? Entries,
        IReadOnlyList<PlaythroughExportDto?>? Playthroughs,
        IReadOnlyList<ReviewExportDto?>? Reviews,
        IReadOnlyList<WishlistExportDto?>? Wishlist,
        IReadOnlyList<FavouriteExportDto?>? Favourites);
}
