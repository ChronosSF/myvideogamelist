using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>The home page's Just out panel (ADR 0073, 0104).</summary>
public interface IJustOutService
{
    /// <summary>
    /// The panel for <paramref name="today"/>, a UTC day, with the games the admin has pinned to the home
    /// page's panels and without the ones hidden from them. Throws when IGDB cannot be asked; the caller
    /// decides what a failure costs.
    /// </summary>
    Task<IReadOnlyList<JustOutDto>> ComposeAsync(
        DateOnly today, ComingSoonPicks picks, CancellationToken cancellationToken = default);
}
