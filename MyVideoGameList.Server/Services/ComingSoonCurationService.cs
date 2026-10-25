using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <remarks>
/// Every write drops this process's copy of the home page, so that the admin sees a pick take effect on the
/// next load rather than up to a quarter of an hour later. Other tasks keep theirs until it lapses, and the
/// edge its own for five minutes more (ADR 0071).
/// </remarks>
public class ComingSoonCurationService(
    ApplicationDbContext db,
    IIgdbService igdb,
    IMemoryCache cache,
    TimeProvider clock) : IComingSoonCurationService
{
    public async Task<IReadOnlyList<ComingSoonPickDto>> ListAsync(CancellationToken cancellationToken = default) =>
        await db.ComingSoonPicks
            .AsNoTracking()
            .OrderBy(p => p.Kind == ComingSoonPickKinds.Pin ? 0 : 1)
            .ThenBy(p => p.Title)
            .Select(p => new ComingSoonPickDto(p.GameId, p.Title, p.Kind, p.PickedAt))
            .ToListAsync(cancellationToken);

    public async Task<ComingSoonPickDto?> SetAsync(
        int gameId, string kind, CancellationToken cancellationToken = default)
    {
        var games = await igdb.GetCalendarGamesAsync([gameId], cancellationToken);
        if (!games.TryGetValue(gameId, out var game)) return null;

        var title = game.Name.Length > ComingSoonPick.TitleMaxLength ? game.Name[..ComingSoonPick.TitleMaxLength] : game.Name;
        var now = clock.GetUtcNow();

        ComingSoonPick saved;
        try
        {
            saved = await WriteAsync(gameId, kind, title, now, cancellationToken);
        }
        catch (DbUpdateException)
        {
            // The row changed between the read and the write: added by the same form submitted twice, or
            // removed by a delete in another tab. Read again and write once more over whatever is there now;
            // a second failure is a real one.
            db.ChangeTracker.Clear();
            saved = await WriteAsync(gameId, kind, title, now, cancellationToken);
        }

        cache.Remove(HomeService.CacheKey);
        return ToDto(saved);
    }

    public async Task<bool> RemoveAsync(int gameId, CancellationToken cancellationToken = default)
    {
        var pick = await db.ComingSoonPicks.FindAsync([gameId], cancellationToken);
        if (pick is null) return false;

        db.ComingSoonPicks.Remove(pick);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Removed by another request after it was read — a delete clicked twice.
            return false;
        }

        cache.Remove(HomeService.CacheKey);
        return true;
    }

    private async Task<ComingSoonPick> WriteAsync(
        int gameId, string kind, string title, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var pick = await db.ComingSoonPicks.FindAsync([gameId], cancellationToken);
        if (pick is null)
        {
            pick = new ComingSoonPick { GameId = gameId, Kind = kind, Title = title, PickedAt = now };
            db.ComingSoonPicks.Add(pick);
        }
        else
        {
            pick.Kind = kind;
            pick.Title = title;
            pick.PickedAt = now;
        }

        await db.SaveChangesAsync(cancellationToken);
        return pick;
    }

    private static ComingSoonPickDto ToDto(ComingSoonPick p) => new(p.GameId, p.Title, p.Kind, p.PickedAt);
}
