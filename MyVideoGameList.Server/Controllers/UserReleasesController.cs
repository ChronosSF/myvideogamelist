using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// What is coming for the signed-in user's games (<c>specs/release-timeline-and-calendar.md</c> §8.2,
/// B1 and B7): the two-week line asks for fourteen days known to the day, the calendar for its months
/// with the month, quarter and year bands as well, and for what is announced with no date at all.
/// </summary>
/// <remarks>
/// <c>no-store</c>, like every answer about one person. The service keeps IGDB's answer in memory for an
/// hour, so a copy kept anywhere between here and the browser would only be a second, staler one.
/// </remarks>
[ApiController]
[Route("api/user/releases")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class UserReleasesController(
    IConnectedReleaseService releases,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ReleaseEntryDto>>> Get(
        [FromQuery] ReleaseWindowQuery window,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        // Both are set: [Required] has already refused a window missing either end.
        var from = window.From ?? throw new ArgumentException("The window needs its first day.", nameof(window));
        var to = window.To ?? throw new ArgumentException("The window needs its last day.", nameof(window));

        return Ok(await releases.GetAsync(
            user.Id, from, to, window.Precision == ReleaseWindowQuery.AnyPrecision, cancellationToken));
    }

    /// <summary>
    /// The connected games IGDB has no date for at all — the calendar's "Announced, no date" (K4). No
    /// window, because there are no dates to put one around.
    /// </summary>
    [HttpGet("undated")]
    public async Task<ActionResult<IReadOnlyList<UndatedEntryDto>>> GetUndated(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return Ok(await releases.GetUndatedAsync(user.Id, cancellationToken));
    }
}
