using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// Other people's profiles, addressed by their public id.
/// </summary>
/// <remarks>
/// <para>
/// Plural, and separate from <see cref="UserController"/>, which is singular and means "the signed
/// in user". The two are not two views of one resource: everything on <c>UserController</c> is
/// scoped by the claims principal and is nobody else's business, and everything here is public by
/// its owner's decision and is addressed by an id in the URL. Folding them together is how a route
/// value ends up being trusted to scope a query.
/// </para>
/// <para>
/// <b>The id, and never the name.</b> A name can be given up and claimed by somebody else, so an
/// address built on one can come to mean another person (ADR 0096). The id never changes and is
/// never another account's; the page puts the name after it for people to read, and redirects any
/// other name to the current one. Nothing here reads a name.
/// </para>
/// <para>
/// Anonymous on purpose, and stated rather than left implicit: these are the pages ROADMAP D8 calls
/// the organic acquisition channel, so they have to render for a crawler that has no cookie. The
/// response is identical for a signed-in reader — including for the profile's own owner, who sees
/// their private figures at <c>/user</c> instead. There is no per-viewer variation here at all,
/// which is what lets the page in front of it be shared-cached.
/// </para>
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
public class UsersController(IPublicProfileService profiles) : ControllerBase
{
    /// <summary>
    /// What one user has published about their tracking.
    /// </summary>
    /// <remarks>
    /// Makes no IGDB call, so it answers while a third party is down — the reviews below are the
    /// half that cannot.
    /// </remarks>
    [HttpGet("{publicId}")]
    public async Task<ActionResult<PublicProfileDto>> GetProfile(
        string publicId, CancellationToken cancellationToken)
    {
        var profile = await profiles.GetProfileAsync(publicId, cancellationToken);

        // Null covers both "no such id" and "that profile is private", and this must not tell them
        // apart. See PublicProfileService.FindPublicAsync.
        return profile is null ? NotFound() : Ok(profile);
    }

    /// <summary>
    /// A page of the reviews that user has marked public.
    /// </summary>
    [HttpGet("{publicId}/reviews")]
    public async Task<ActionResult<PublicReviewsDto>> GetReviews(
        string publicId,
        CancellationToken cancellationToken,
        // Defaulted rather than required: /reviews with no query string is the first page.
        [FromQuery][Range(1, int.MaxValue)] int page = 1)
    {
        var reviews = await profiles.GetReviewsAsync(publicId, page, cancellationToken);
        return reviews is null ? NotFound() : Ok(reviews);
    }

    /// <summary>
    /// The games that user has made favourites, in the order they arranged them: those placed by hand
    /// first, then the rest most recent first.
    /// </summary>
    /// <remarks>
    /// Not paged. A showcase is read as a whole, and the profile page renders it on the server in one
    /// pass. The count on the profile document is what decides whether the section appears at all,
    /// which is why it is there and not only here: this is the half that fails when IGDB does.
    /// </remarks>
    [HttpGet("{publicId}/favourites")]
    public async Task<ActionResult<PublicFavouritesDto>> GetFavourites(
        string publicId, CancellationToken cancellationToken)
    {
        var favourites = await profiles.GetFavouritesAsync(publicId, cancellationToken);
        return favourites is null ? NotFound() : Ok(favourites);
    }
}
