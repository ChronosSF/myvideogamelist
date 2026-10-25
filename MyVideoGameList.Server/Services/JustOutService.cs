using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services.Releases;

namespace MyVideoGameList.Server.Services;

/// <remarks>
/// Reads nothing of ours: the hides are the Coming soon picks the home composite has already read, since the
/// composite runs this beside the parts that use the request's database context.
/// </remarks>
public class JustOutService(IIgdbService igdb) : IJustOutService
{
    public async Task<IReadOnlyList<JustOutDto>> ComposeAsync(
        DateOnly today, IReadOnlySet<int> hidden, CancellationToken cancellationToken = default)
    {
        var candidates = await igdb.GetJustOutCandidatesAsync(today, cancellationToken);

        return JustOut.Compose(candidates, hidden, today)
            .Select(r => new JustOutDto(r.Game.Id, r.Game.Name, r.Game.CoverImageUrl, r.Released, r.Platforms))
            .ToList();
    }
}
