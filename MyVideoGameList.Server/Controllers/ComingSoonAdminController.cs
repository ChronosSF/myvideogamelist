using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The admin page's side of the home page's Coming soon panel: the games pinned to it and hidden from it
/// (ADR 0071).
/// </summary>
/// <remarks>
/// Behind <see cref="AdminPolicy"/> from the class and <c>no-store</c> on everything, for the reasons
/// <see cref="CalendarAdminController"/> gives.
/// </remarks>
[ApiController]
[Route("api/admin/coming-soon")]
[Authorize(Policy = AdminPolicy.Name)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class ComingSoonAdminController(IComingSoonCurationService curation) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<ComingSoonPickDto>>> List(CancellationToken cancellationToken) =>
        Ok(await curation.ListAsync(cancellationToken));

    /// <summary>Pins or hides a game by its IGDB id — the number in its page's address.</summary>
    /// <remarks>An id IGDB has no game for is refused as a problem with the id, so the form can say so.</remarks>
    [HttpPut("{gameId:int}")]
    public async Task<ActionResult<ComingSoonPickDto>> Set(
        [Range(1, int.MaxValue)] int gameId,
        [FromBody] ComingSoonPickInputDto input,
        CancellationToken cancellationToken)
    {
        var saved = await curation.SetAsync(gameId, input.Kind, cancellationToken);
        if (saved is not null) return Ok(saved);

        ModelState.AddModelError(nameof(gameId), "IGDB has no game with that id.");
        return ValidationProblem(ModelState);
    }

    [HttpDelete("{gameId:int}")]
    public async Task<IActionResult> Remove(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken) =>
        await curation.RemoveAsync(gameId, cancellationToken) ? NoContent() : NotFound();
}
