using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Observability;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// <c>GET /api/version</c>: which commit this process was built from, and when its image was built.
/// </summary>
/// <remarks>
/// <para>
/// Nothing is computed and nothing is asked of the database or IGDB, so it answers whenever the
/// process does — the promise <c>/healthz</c> makes. See <see cref="BuildVersion"/> for where the
/// values come from.
/// </para>
/// <para>
/// Under <c>/api/</c>, unlike the two health endpoints, because one hostname serves both processes
/// and the balancer sends every path it does not name to the SSR server. That server answers
/// <c>/version</c> for itself; at the same path the two would collide, and this one could be reached
/// through the distribution only by a listener rule that hid the other. Here it is routed as every
/// API call is. See <c>docs/decisions/0059-*</c>.
/// </para>
/// <para>
/// Anonymous, because whoever is asking what is running has no cookie. Never stored, because an
/// answer kept anywhere is wrong from the next deploy on. No cancellation token: there is nothing
/// below it to hand one to.
/// </para>
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[AllowAnonymous]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class VersionController(IConfiguration configuration) : ControllerBase
{
    [HttpGet]
    public ActionResult<BuildVersionDto> Get() => Ok(BuildVersion.Read(configuration));
}
