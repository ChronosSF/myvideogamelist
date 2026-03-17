using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("[controller]")]
public class GamesController(ApplicationDbContext db) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IEnumerable<GameDto>>> GetGames()
    {
        var games = await db.Games
            .Include(g => g.GamePlatforms).ThenInclude(gp => gp.Platform)
            .Include(g => g.GameGenres).ThenInclude(gg => gg.Genre)
            .Include(g => g.GameDevelopers).ThenInclude(gd => gd.Developer)
            .Include(g => g.GamePublishers).ThenInclude(gp => gp.Publisher)
            .AsSplitQuery()
            .AsNoTracking()
            .ToListAsync();

        var result = games.Select(g => new GameDto(
            g.Id,
            g.Title,
            g.Description,
            g.ReleaseDate,
            g.CoverImageUrl,
            g.BackgroundImageUrl,
            g.TrailerUrl,
            g.Website,
            g.Rating,
            g.MetacriticScore,
            g.EsrbRating,
            g.GamePlatforms.Select(gp => new PlatformDto(
                gp.Platform.Id, gp.Platform.Name, gp.Platform.Abbreviation,
                gp.Platform.LogoUrl, gp.Platform.Manufacturer)),
            g.GameGenres.Select(gg => new GenreDto(
                gg.Genre.Id, gg.Genre.Name, gg.Genre.Description)),
            g.GameDevelopers.Select(gd => new DeveloperDto(
                gd.Developer.Id, gd.Developer.Name, gd.Developer.Country,
                gd.Developer.FoundedYear, gd.Developer.Website,
                gd.Developer.LogoUrl, gd.Developer.Description)),
            g.GamePublishers.Select(gp => new PublisherDto(
                gp.Publisher.Id, gp.Publisher.Name, gp.Publisher.Country,
                gp.Publisher.FoundedYear, gp.Publisher.Website,
                gp.Publisher.LogoUrl, gp.Publisher.Description))
        ));

        return Ok(result);
    }
}
