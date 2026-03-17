using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("[controller]")]
public class DevelopersController(ApplicationDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<DeveloperDto>>> GetDevelopers()
    {
        var developers = await db.Developers
            .AsNoTracking()
            .ToListAsync();

        var result = developers.Select(d => new DeveloperDto(
            d.Id, d.Name, d.Country, d.FoundedYear, d.Website, d.LogoUrl, d.Description));

        return Ok(result);
    }
}
