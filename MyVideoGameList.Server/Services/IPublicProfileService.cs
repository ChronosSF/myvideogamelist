using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads what one user has chosen to publish, addressed by username rather than by account id.
/// </summary>
/// <remarks>
/// Every method returns null for "there is no public profile here", and deliberately does not
/// distinguish a username nobody has claimed from one whose owner keeps their profile private.
/// See <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
/// </remarks>
public interface IPublicProfileService
{
    Task<PublicProfileDto?> GetProfileAsync(
        string userName, CancellationToken cancellationToken = default);

    /// <param name="page">1-based. Out-of-range pages return an empty list, not an error.</param>
    Task<PublicReviewsDto?> GetReviewsAsync(
        string userName, int page, CancellationToken cancellationToken = default);

    /// <summary>
    /// Every game the user has made a favourite, most recent first. See
    /// <c>docs/decisions/0029-favourites-are-an-axis-and-a-showcase.md</c>.
    /// </summary>
    Task<PublicFavouritesDto?> GetFavouritesAsync(
        string userName, CancellationToken cancellationToken = default);
}
