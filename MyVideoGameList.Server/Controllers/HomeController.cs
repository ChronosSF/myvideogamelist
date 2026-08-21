using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HomeController(IHomeService homeService) : ControllerBase
{
    /// <summary>
    /// The shared content of the home page — spotlight, popular covers and Steam news.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<HomeResponse>> GetHome(CancellationToken cancellationToken)
    {
        var result = await homeService.GetHomeAsync(cancellationToken);
        return Ok(result);
    }
}
