using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The admin page's moderation card: what readers reported, a review hidden or shown again, a profile's
/// display name, picture or bio cleared, and reports dismissed (ADR 0076).
/// </summary>
/// <remarks>
/// Behind <see cref="AdminPolicy"/> from the class, as every admin controller is, and a test finds it by its
/// route. <c>no-store</c>, because every answer is for one person and about members' words. The one admin
/// page that writes anything of a member's, and what it writes is ADR 0076's amendment to 0042: a hide and
/// three nulls, each something the member could have done themselves.
/// </remarks>
[ApiController]
[Route("api/admin/moderation")]
[Authorize(Policy = AdminPolicy.Name)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class ModerationAdminController(IModerationService moderation) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<ModerationQueueDto>> Get(CancellationToken cancellationToken) =>
        Ok(await moderation.GetQueueAsync(cancellationToken));

    [HttpPut("reviews/{reviewId:int}/hidden")]
    public async Task<IActionResult> Hide([Range(1, int.MaxValue)] int reviewId, CancellationToken cancellationToken) =>
        await moderation.HideReviewAsync(reviewId, cancellationToken) ? NoContent() : NotFound();

    [HttpDelete("reviews/{reviewId:int}/hidden")]
    public async Task<IActionResult> Show([Range(1, int.MaxValue)] int reviewId, CancellationToken cancellationToken) =>
        await moderation.ShowReviewAsync(reviewId, cancellationToken) ? NoContent() : NotFound();

    /// <summary>Answered whether or not anything was left to dismiss: a second tab may have got there first.</summary>
    [HttpDelete("reviews/{reviewId:int}/reports")]
    public async Task<IActionResult> DismissReview(
        [Range(1, int.MaxValue)] int reviewId, CancellationToken cancellationToken)
    {
        await moderation.DismissReviewReportsAsync(reviewId, cancellationToken);
        return NoContent();
    }

    /// <summary>
    /// A 409 when the owner saved their profile since it was read: nothing was cleared, and the admin sees
    /// what they saved before choosing again.
    /// </summary>
    [HttpPost("profiles/{accountId}/clear")]
    public async Task<IActionResult> Clear(
        [StringLength(450, MinimumLength = 1)] string accountId,
        [FromBody] ClearProfileDto fields,
        CancellationToken cancellationToken) =>
        await moderation.ClearProfileAsync(accountId, fields, cancellationToken) switch
        {
            ProfileClear.Cleared => NoContent(),
            ProfileClear.Conflict => Conflict(),
            _ => NotFound(),
        };

    [HttpDelete("profiles/{accountId}/reports")]
    public async Task<IActionResult> DismissProfile(
        [StringLength(450, MinimumLength = 1)] string accountId, CancellationToken cancellationToken)
    {
        await moderation.DismissProfileReportsAsync(accountId, cancellationToken);
        return NoContent();
    }
}
