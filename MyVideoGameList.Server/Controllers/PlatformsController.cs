using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class PlatformsController(IIgdbService igdbService) : ControllerBase
{
    /// <summary>
    /// Returns the active platforms configured in app settings (ActivePlatforms), which the browse
    /// filter offers and the profile statistics name platforms from.
    /// </summary>
    [HttpGet("active")]
    public async Task<ActionResult<IEnumerable<PlatformDto>>> GetActivePlatforms()
    {
        var result = await igdbService.GetActivePlatformsAsync();
        return Ok(result);
    }
}
