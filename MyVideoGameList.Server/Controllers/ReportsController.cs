using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// A reader reporting a published review, or a public profile's name, picture and bio (ADR 0076 §1).
/// </summary>
/// <remarks>
/// Signed in, because an account is what holds a reader to one report of each thing; the site has no rate
/// limit on anything else (ADR 0033), and a report from nobody in particular could fill the queue as fast
/// as a script can post. Not rate-limited either, for that reason: the one-per-reader index is the bound.
/// </remarks>
[ApiController]
[Route("api/reports")]
[Authorize]
public class ReportsController(IContentReportService reports, UserManager<ApplicationUser> userManager) : ControllerBase
{
    /// <summary>
    /// Reports it, or changes the reason and note of this reader's report of it. The same 204 either way,
    /// so the answer says nothing about anybody else's reports; a 404 when nothing published answers to it.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Report([FromBody] ReportInputDto input, CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        return await reports.ReportAsync(userId, input, cancellationToken) ? NoContent() : NotFound();
    }
}
