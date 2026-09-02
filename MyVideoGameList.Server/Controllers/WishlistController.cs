using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// Games the user wants. A separate axis from the status lists, so a separate controller.
/// </summary>
/// <remarks>
/// Routing this through <see cref="ListsController"/> would have implied the wishlist is a sixth
/// status, which is exactly the shape the data model rejects: the five statuses are mutually
/// exclusive and the wishlist sits alongside whichever one a game holds.
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class WishlistController(
    IWishlistService wishlistService,
    UserManager<ApplicationUser> userManager) : ControllerBase
{
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WishlistItemDto>>> GetWishlist(
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        return Ok(await wishlistService.GetWishlistAsync(user.Id, cancellationToken));
    }

    /// <summary>
    /// Puts a game on the wishlist. <c>PUT</c> rather than <c>POST</c> because it is idempotent:
    /// wishlisting a game already wishlisted succeeds and changes nothing, including the
    /// timestamp the list is ordered by.
    /// </summary>
    [HttpPut("{gameId:int}")]
    public async Task<IActionResult> Add(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        await wishlistService.AddAsync(user.Id, gameId, cancellationToken);
        return NoContent();
    }

    [HttpDelete("{gameId:int}")]
    public async Task<IActionResult> Remove(
        [Range(1, int.MaxValue)] int gameId,
        CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        var removed = await wishlistService.RemoveAsync(user.Id, gameId, cancellationToken);
        return removed ? NoContent() : NotFound();
    }
}
