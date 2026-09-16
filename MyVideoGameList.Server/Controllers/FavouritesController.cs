using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The signed-in user's favourite games. An axis of its own, so a controller of its own.
/// </summary>
/// <remarks>
/// The same three endpoints as <see cref="WishlistController"/>, with the same contract. Somebody
/// else's favourites are read through <see cref="UsersController"/>, by name, and only when their
/// profile is public.
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FavouritesController(
    IFavouriteService favouriteService,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<FavouriteDto>>> GetFavourites(
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return Ok(await favouriteService.GetFavouritesAsync(user.Id, cancellationToken));
    }

    /// <summary>
    /// Makes a game a favourite. <c>PUT</c> rather than <c>POST</c> because it is idempotent: doing it
    /// twice succeeds and changes nothing, including the timestamp the favourites are ordered by —
    /// which it answers with, whichever request set it, as the wishlist's does.
    /// </summary>
    [HttpPut("{gameId:int}")]
    public async Task<ActionResult<FavouriteAddedDto>> Add(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var addedAt = await favouriteService.AddAsync(user.Id, gameId, cancellationToken);
        return Ok(new FavouriteAddedDto(addedAt));
    }

    [HttpDelete("{gameId:int}")]
    public async Task<IActionResult> Remove(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var removed = await favouriteService.RemoveAsync(user.Id, gameId, cancellationToken);
        return removed ? NoContent() : NotFound();
    }
}
