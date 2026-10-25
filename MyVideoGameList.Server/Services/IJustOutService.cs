using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>The home page's Just out panel (ADR 0073).</summary>
public interface IJustOutService
{
    /// <summary>
    /// The panel for <paramref name="today"/>, a UTC day, without the games the admin has hidden from the
    /// home page's panels. Throws when IGDB cannot be asked; the caller decides what a failure costs.
    /// </summary>
    Task<IReadOnlyList<JustOutDto>> ComposeAsync(
        DateOnly today, IReadOnlySet<int> hidden, CancellationToken cancellationToken = default);
}
