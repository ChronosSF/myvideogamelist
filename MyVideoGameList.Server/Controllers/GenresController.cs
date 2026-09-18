using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
public class GenresController(IIgdbService igdbService) : ControllerBase
{
    /// <summary>
    /// IGDB's genres, by name — what the browse listing's genre filter offers.
    /// </summary>
    /// <remarks>
    /// Read from IGDB rather than kept in a table or a client constant, because IGDB is the source of
    /// truth for what a genre is (ADR 0001) and the ids are what the games query filters on.
    /// </remarks>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<GenreDto>>> GetGenres(CancellationToken cancellationToken)
    {
        return Ok(await igdbService.GetGenresAsync(cancellationToken));
    }
}
