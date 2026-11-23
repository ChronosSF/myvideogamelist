using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The Just out panel as composed: its games, and whether IGDB could be asked for only one of the two lists
/// they are taken from, so that the panel is that list's alone (ADR 0104).
/// </summary>
public sealed record JustOutPanel(IReadOnlyList<JustOutDto> Games, bool Partial);

/// <summary>The home page's Just out panel (ADR 0073, 0104).</summary>
public interface IJustOutService
{
    /// <summary>
    /// The panel for <paramref name="today"/>, a UTC day, with the games the admin has pinned to the home
    /// page's panels and without the ones hidden from them. Throws when IGDB can be asked for neither of the
    /// panel's lists; the caller decides what a failure costs, and what a partial panel does.
    /// </summary>
    Task<JustOutPanel> ComposeAsync(
        DateOnly today, ComingSoonPicks picks, CancellationToken cancellationToken = default);
}
