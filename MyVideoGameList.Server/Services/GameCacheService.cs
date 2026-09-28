using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <inheritdoc cref="IGameCacheService"/>
public class GameCacheService(
    ApplicationDbContext db,
    IIgdbService igdbService,
    TimeProvider clock,
    ILogger<GameCacheService> logger) : IGameCacheService
{
    /// <summary>
    /// How long a row is served without asking IGDB again.
    /// </summary>
    /// <remarks>
    /// A day. What this cache holds barely changes — a title, a cover, a release date — and the one
    /// figure that moves, the player rating, moves slowly and is shown rounded on a card. Shorter
    /// would spend IGDB's four-a-second allowance re-reading games nobody's shelf has changed;
    /// much longer would leave a newly released game looking unrated for a week.
    /// </remarks>
    internal static readonly TimeSpan RefreshAfter = TimeSpan.FromHours(24);

    /// <summary>
    /// The same casing the API answers in, so a payload read back matches what was stored and a
    /// human reading the column sees the shape they see in the browser.
    /// </summary>
    private static readonly JsonSerializerOptions PayloadFormat = new(JsonSerializerDefaults.Web);

    public async Task<IReadOnlyList<GameDto>> GetGamesAsync(
        IEnumerable<int> ids, CancellationToken cancellationToken = default)
    {
        var wanted = ids.Distinct().ToList();
        if (wanted.Count == 0) return [];

        var stored = await db.CachedGames
            .AsNoTracking()
            .Where(game => wanted.Contains(game.GameId))
            .ToDictionaryAsync(game => game.GameId, cancellationToken);

        var now = clock.GetUtcNow();

        // A tombstone counts as known, which is the point of writing one: an id IGDB has no answer
        // for is left alone for as long as a live one would be.
        var ask = wanted
            .Where(id => !stored.TryGetValue(id, out var row) || now - row.RefreshedAt >= RefreshAfter)
            .ToList();

        var fetched = ask.Count == 0
            ? []
            : await RefreshAsync(ask, now, cancellationToken);

        return Merge(wanted, stored, fetched);
    }

    public async Task StoreAsync(
        IReadOnlyCollection<GameDto> games, CancellationToken cancellationToken = default)
    {
        // Deduplicated by the caller's data rather than trusted from it: the write below indexes
        // the list by id, and two copies of one game would take the whole write down with an
        // exception the caller never asked for.
        var distinct = games.DistinctBy(game => game.Id).ToList();
        if (distinct.Count == 0) return;

        var now = clock.GetUtcNow();
        var ids = distinct.Select(game => game.Id).ToList();

        // Rows already inside the refresh interval are left alone. A warm has no better answer for
        // them than the refresh that wrote them, and callers hand over overlapping sets seconds
        // apart — an import's matching passes offer many of the same games again and again — so
        // without this one import rewrites the same jsonb rows hundreds of times, and the write-ahead
        // log carries every one.
        var fresh = await db.CachedGames
            .AsNoTracking()
            .Where(game => ids.Contains(game.GameId))
            .Select(game => new { game.GameId, game.RefreshedAt })
            .ToListAsync(cancellationToken);

        var known = fresh
            .Where(game => now - game.RefreshedAt < RefreshAfter)
            .Select(game => game.GameId)
            .ToHashSet();

        var wanted = distinct.Where(game => !known.Contains(game.Id)).ToList();
        if (wanted.Count == 0) return;

        await StoreAsync(
            wanted.Select(game => game.Id).ToList(), wanted, now, cancellationToken);
    }

    /// <summary>
    /// Asks IGDB for the ids that are missing or past <see cref="RefreshAfter"/>, and stores what
    /// comes back.
    /// </summary>
    private async Task<IReadOnlyList<GameDto>> RefreshAsync(
        List<int> ask, DateTimeOffset now, CancellationToken cancellationToken)
    {
        List<GameDto> games;

        // Only the call to IGDB is inside this. Review on #90 caught the first version wrapping the
        // write as well, which meant a database hiccup was logged as an IGDB outage and threw away
        // games already in hand.
        try
        {
            games = (await igdbService.GetGamesByIdsAsync(ask, cancellationToken)).ToList();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Swallowing an IGDB failure is exactly what this class is for, and the backend rules
            // ask the deliberate ones to say so: the caller is rendering somebody's own library,
            // and a stale shelf beats a 502 about a third party. A row nobody has cached yet is
            // simply absent from the answer, which is how a list already treats a game IGDB does
            // not return.
            logger.LogWarning(
                ex,
                "IGDB did not answer for {Count} game ids; serving what is already cached",
                ask.Count);

            return [];
        }

        // Storing is the optimisation, not the answer: whatever happens to the write, the caller
        // gets what IGDB just said.
        await StoreAsync(ask, games, now, cancellationToken);
        return games;
    }

    /// <summary>
    /// Writes what IGDB said, and never throws for it. A cache that cannot be written is a page
    /// that is slower next time; a cache that throws is a page that fails now.
    /// </summary>
    private async Task StoreAsync(
        List<int> asked, List<GameDto> games, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            await WriteAsync(asked, games, now, cancellationToken);
        }
        catch (DbUpdateException ex)
        {
            // Two requests refreshing the same game at once, which is ordinary: one inserts and the
            // other loses. Nothing is lost - they were writing the same answer.
            logger.LogDebug(ex, "A concurrent request had already cached these games");
            Forget();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The database itself. Said plainly rather than as an IGDB failure, which is what the
            // caller above would otherwise have reported.
            logger.LogWarning(ex, "Could not cache {Count} games; the answer is unaffected", asked.Count);
            Forget();
        }

        // Leave the caller's context as it was found: pending cache rows that failed to save would
        // otherwise be retried by whatever the request saves next, and fail it too.
        void Forget()
        {
            foreach (var entry in db.ChangeTracker.Entries<CachedGame>().ToList())
                entry.State = EntityState.Detached;
        }
    }

    private async Task WriteAsync(
        List<int> asked, List<GameDto> games, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var fetched = games.ToDictionary(game => game.Id);

        var rows = await db.CachedGames
            .Where(game => asked.Contains(game.GameId))
            .ToDictionaryAsync(game => game.GameId, cancellationToken);

        foreach (var id in asked)
        {
            if (!rows.TryGetValue(id, out var row))
            {
                row = new CachedGame { GameId = id };
                db.CachedGames.Add(row);
            }

            // Absent from the response means IGDB has no such game: the row is written anyway,
            // without a payload, so the id is not asked about again on every page load.
            var game = fetched.GetValueOrDefault(id);

            row.Payload = game is null ? null : JsonSerializer.Serialize(game, PayloadFormat);
            row.Title = game?.Title;
            row.ReleaseDate = game?.ReleaseDate;
            row.CoverImageUrl = game?.CoverImageUrl;
            row.Rating = game?.Rating;
            row.RefreshedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// What was just fetched, then what was already stored — including rows past their refresh
    /// interval, which is what makes an IGDB outage cost nothing here.
    /// </summary>
    private IReadOnlyList<GameDto> Merge(
        List<int> wanted,
        Dictionary<int, CachedGame> stored,
        IReadOnlyList<GameDto> fetched)
    {
        var byId = fetched.ToDictionary(game => game.Id);
        var games = new List<GameDto>(wanted.Count);

        foreach (var id in wanted)
        {
            if (byId.TryGetValue(id, out var fresh))
            {
                games.Add(fresh);
                continue;
            }

            if (stored.TryGetValue(id, out var row) && Read(row) is { } cached)
                games.Add(cached);
        }

        return games;
    }

    private GameDto? Read(CachedGame row)
    {
        if (row.Payload is null) return null;

        try
        {
            return JsonSerializer.Deserialize<GameDto>(row.Payload, PayloadFormat);
        }
        catch (JsonException ex)
        {
            // A payload written before a change to GameDto's shape. Dropping it loses one game
            // from one page until the refresh interval rewrites the row, which is a better failure
            // than the whole shelf throwing.
            logger.LogWarning(ex, "Discarding an unreadable cached payload for game {GameId}", row.GameId);
            return null;
        }
    }
}
