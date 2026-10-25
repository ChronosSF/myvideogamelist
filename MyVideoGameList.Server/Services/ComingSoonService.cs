using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Services;

public class ComingSoonService(ApplicationDbContext db, IIgdbService igdb) : IComingSoonService
{
    public async Task<ComingSoonPicks> GetPicksAsync(CancellationToken cancellationToken = default)
    {
        var picks = await db.ComingSoonPicks
            .AsNoTracking()
            .Select(p => new { p.GameId, p.Kind })
            .ToListAsync(cancellationToken);

        return new ComingSoonPicks(
            picks.Where(p => p.Kind == ComingSoonPickKinds.Pin).Select(p => p.GameId).ToHashSet(),
            picks.Where(p => p.Kind == ComingSoonPickKinds.Hide).Select(p => p.GameId).ToHashSet());
    }

    public async Task<IReadOnlyList<ComingSoonDto>> ComposeAsync(
        DateOnly today, ComingSoonPicks picks, CancellationToken cancellationToken = default)
    {
        var candidates = await igdb.GetComingSoonCandidatesAsync(today, [.. picks.Pinned], cancellationToken);

        return ComingSoon.Compose(candidates.Games, picks.Pinned, picks.Hidden, today)
            .Select(r => new ComingSoonDto(
                r.Game.Id,
                r.Game.Name,
                r.Game.CoverImageUrl,
                r.Precision switch
                {
                    ReleasePrecision.Day => "day",
                    ReleasePrecision.Month => "month",
                    _ => "quarter",
                },
                r.Starts,
                r.Platforms))
            .ToList();
    }
}
