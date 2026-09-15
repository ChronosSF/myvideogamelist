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
    /// written first. Rewriting a review does not move it.
    /// </summary>
    /// <param name="after">
    /// Null for the first page; otherwise the <see cref="GameReviewsDto.Next"/> of the page before.
    /// A cursor past the end returns an empty list and the total, not an error.
    /// </param>
    /// <exception cref="ArgumentException">
    /// <paramref name="after"/> is not a cursor this deployment issued — malformed, tampered with, or
    /// protected under a key ring it does not hold.
    /// </exception>
    Task<GameReviewsDto> GetReviewsAsync(
        int gameId, string? after, CancellationToken cancellationToken = default);
}
