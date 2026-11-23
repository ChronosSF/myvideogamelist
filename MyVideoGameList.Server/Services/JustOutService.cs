using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Services;

/// <remarks>
/// Reads nothing of ours: the pins and hides are the Coming soon picks the home composite has already read,
/// since the composite runs this beside the parts that use the request's database context.
/// </remarks>
public class JustOutService(IIgdbService igdb) : IJustOutService
{
    public async Task<JustOutPanel> ComposeAsync(
        DateOnly today, ComingSoonPicks picks, CancellationToken cancellationToken = default)
    {
        var candidates = await igdb.GetJustOutCandidatesAsync(today, [.. picks.Pinned], cancellationToken);

        var games = JustOut.Compose(candidates.Games, picks.Pinned, picks.Hidden, today)
            .Select(r => new JustOutDto(r.Game.Id, r.Game.Name, r.Game.CoverImageUrl, r.Released, r.Platforms))
            .ToList();

        return new JustOutPanel(games, candidates.Partial);
    }
}
