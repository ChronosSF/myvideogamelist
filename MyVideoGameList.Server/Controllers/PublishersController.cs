using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("[controller]")]
public class PublishersController(ApplicationDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<PublisherDto>>> GetPublishers()
    {
        var publishers = await db.Publishers
            .AsNoTracking()
            .ToListAsync();

        var result = publishers.Select(p => new PublisherDto(
            p.Id, p.Name, p.Country, p.FoundedYear, p.Website, p.LogoUrl, p.Description));

        return Ok(result);
    }
}
