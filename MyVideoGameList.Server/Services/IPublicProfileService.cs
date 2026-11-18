using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads what one user has chosen to publish, addressed by the profile's public id: never by a
/// username, which can change hands, and never by the account id, which is private (ADR 0096).
/// </summary>
/// <remarks>
/// Every method returns null for "there is no public profile here", and deliberately does not
/// distinguish an id nobody holds from one whose owner keeps their profile private.
/// See <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
/// </remarks>
public interface IPublicProfileService
{
    Task<PublicProfileDto?> GetProfileAsync(
        string publicId, CancellationToken cancellationToken = default);

    /// <param name="page">1-based. Out-of-range pages return an empty list, not an error.</param>
    Task<PublicReviewsDto?> GetReviewsAsync(
        string publicId, int page, CancellationToken cancellationToken = default);

    /// <summary>
    /// Every game the user has made a favourite, in the order they arranged their showcase in: those
    /// placed by hand first, then the rest most recent first. See
    /// <c>docs/decisions/0029-favourites-are-an-axis-and-a-showcase.md</c> and <c>0064-*</c>.
    /// </summary>
    Task<PublicFavouritesDto?> GetFavouritesAsync(
        string publicId, CancellationToken cancellationToken = default);
}
