using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads what the community has recorded about one game, across every account.
/// </summary>
/// <remarks>
/// The game-scoped counterpart of <see cref="IPublicProfileService"/>, which reads one person across
/// every game. Neither method returns null, because a game nobody has scored or reviewed is an
/// answer — a 404 would be indistinguishable from the game not existing. See
/// <c>docs/decisions/0028-*</c>.
/// </remarks>
public interface IGameCommunityService
{
    /// <summary>
    /// Every member's score for the game, whatever their profile visibility: it names nobody.
    /// </summary>
    Task<CommunityScoresDto> GetScoresAsync(int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The reviews published about the game — marked public, on a public profile — most recently
    /// written or rewritten first.
    /// </summary>
    /// <param name="page">1-based. Out-of-range pages return an empty list and the total, not an error.</param>
    Task<GameReviewsDto> GetReviewsAsync(
        int gameId, int page, CancellationToken cancellationToken = default);
}
