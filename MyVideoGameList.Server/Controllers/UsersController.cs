using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// Other people's profiles, addressed by username.
/// </summary>
/// <remarks>
/// <para>
/// Plural, and separate from <see cref="UserController"/>, which is singular and means "the signed
/// in user". The two are not two views of one resource: everything on <c>UserController</c> is
/// scoped by the claims principal and is nobody else's business, and everything here is public by
/// its owner's decision and is addressed by a name in the URL. Folding them together is how a route
/// value ends up being trusted to scope a query.
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
    [HttpGet("{userName}")]
    public async Task<ActionResult<PublicProfileDto>> GetProfile(
        string userName, CancellationToken cancellationToken)
    {
        var profile = await profiles.GetProfileAsync(userName, cancellationToken);

        // Null covers both "no such username" and "that profile is private", and this must not
        // tell them apart. See PublicProfileService.FindPublicAsync.
        return profile is null ? NotFound() : Ok(profile);
    }

    /// <summary>
    /// A page of the reviews that user has marked public.
    /// </summary>
    [HttpGet("{userName}/reviews")]
    public async Task<ActionResult<PublicReviewsDto>> GetReviews(
        string userName,
        CancellationToken cancellationToken,
        // Defaulted rather than required: /reviews with no query string is the first page.
        [FromQuery][Range(1, int.MaxValue)] int page = 1)
    {
        var reviews = await profiles.GetReviewsAsync(userName, page, cancellationToken);
        return reviews is null ? NotFound() : Ok(reviews);
    }
}
