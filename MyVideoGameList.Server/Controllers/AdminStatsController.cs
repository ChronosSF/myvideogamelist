using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The admin page's statistics: what members do on the site, counted (ADR 0051).
/// </summary>
/// <remarks>
/// Behind <see cref="AdminPolicy"/> from the class, as every admin controller is, and a test says so.
/// <c>no-store</c>, because the answer is for one person and is only true when it is asked.
/// </remarks>
[ApiController]
[Route("api/admin/stats")]
[Authorize(Policy = AdminPolicy.Name)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class AdminStatsController(IAdminStatsService stats) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<AdminStatsDto>> Get(CancellationToken cancellationToken) =>
        Ok(await stats.GetAsync(cancellationToken));
}
