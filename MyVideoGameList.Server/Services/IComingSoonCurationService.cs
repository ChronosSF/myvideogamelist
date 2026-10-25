using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The Coming soon panel's picks, as the admin page edits them: the games pinned to it and hidden from it
/// (ADR 0071).
/// </summary>
/// <remarks>
/// Only that table, for the reason <see cref="ICalendarCurationService"/> gives (A3). Who may call it is the
/// admin policy's business, not this service's.
/// </remarks>
public interface IComingSoonCurationService
{
    /// <summary>Every pick, pinned games first, then by title.</summary>
    Task<IReadOnlyList<ComingSoonPickDto>> ListAsync(CancellationToken cancellationToken = default);

    /// <summary>
    /// Pins or hides a game, replacing whichever it was. Null when IGDB has no game by that id; throws when
    /// IGDB cannot be asked, since a pick is named by what IGDB calls the game.
    /// </summary>
    Task<ComingSoonPickDto?> SetAsync(int gameId, string kind, CancellationToken cancellationToken = default);

    /// <summary>False when the game was neither pinned nor hidden.</summary>
    Task<bool> RemoveAsync(int gameId, CancellationToken cancellationToken = default);
}
