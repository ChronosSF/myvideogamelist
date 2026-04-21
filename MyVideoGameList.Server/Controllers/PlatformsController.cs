using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PlatformsController(IIgdbService igdbService) : ControllerBase
{
    /// <summary>
    /// Returns platforms from IGDB that were updated during the previous calendar year,
    /// used to populate the platform preference settings for the upcoming releases timeline.
    /// </summary>
    [HttpGet("active")]
    public async Task<ActionResult<IEnumerable<PlatformDto>>> GetActivePlatforms()
    {
        var result = await igdbService.GetActivePlatformsAsync();
        return Ok(result);
    }
}
