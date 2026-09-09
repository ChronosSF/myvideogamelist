using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IReviewService
{
    /// <summary>The user's review of one game, or null when they have not written one.</summary>
    Task<ReviewDto?> GetAsync(string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes or rewrites the user's review of a game, creating the entry if this is the first
    /// thing they have recorded about it.
    /// </summary>
    /// <remarks>
    /// One review per game, so there is no create/update distinction to expose — writing a second
    /// one replaces the first rather than adding a row. Writes no <c>UserGameEvent</c> and touches
    /// no status, exactly as a playthrough does not.
    /// </remarks>
    /// <exception cref="ArgumentException">
    /// The playthrough id does not belong to this user and this game.
    /// </exception>
    Task<ReviewDto> UpsertAsync(
        string userId, int gameId, ReviewInputDto input, CancellationToken cancellationToken = default);

    /// <summary>Deletes the user's review of a game. False when there was none.</summary>
    Task<bool> DeleteAsync(string userId, int gameId, CancellationToken cancellationToken = default);
}
