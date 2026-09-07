using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class UserController(
    UserManager<ApplicationUser> userManager,
    ApplicationDbContext db,
    IStatsService stats) : ControllerBase
{
    [HttpPut("theme")]
    public async Task<IActionResult> UpdateTheme([FromBody] UpdateThemeDto dto)
    {
        if (dto.Theme != "light" && dto.Theme != "dark")
            return BadRequest(new { message = "Theme must be 'light' or 'dark'." });

        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        user.Theme = dto.Theme;
        await userManager.UpdateAsync(user);
        return NoContent();
    }

    /// <summary>
    /// The list-view preferences, fetched by the lists page alongside the lists themselves.
    /// Deliberately not folded into the profile endpoint, which is called on every page load and
    /// has no use for them.
    /// </summary>
    [HttpGet("list-preferences")]
    public async Task<ActionResult<ListPreferencesDto>> GetListPreferences(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        // Only the lists the user has actually changed have rows; the rest fall back to the
        // client's default.
        var sorts = await db.UserListSortPreferences
            .Where(p => p.UserId == user.Id)
            .Join(db.ListStatuses, p => p.StatusId, s => s.Id, (p, s) => new { s.Key, p.SortKey, p.Descending })
            .ToListAsync(cancellationToken);

        return Ok(new ListPreferencesDto(
            user.ListView,
            sorts.ToDictionary(x => x.Key, x => new ListSortDto(x.SortKey, x.Descending))));
    }

    [HttpPut("list-preferences")]
    public async Task<IActionResult> UpdateListPreferences(
        [FromBody] UpdateListPreferencesDto dto, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        user.ListView = dto.View;
        await userManager.UpdateAsync(user);

        // Replace wholesale, the same way hidden platforms are handled: the client owns the full
        // set and sends it, so there is no partial-update ambiguity.
        var existing = await db.UserListSortPreferences
            .Where(p => p.UserId == user.Id)
            .ToListAsync(cancellationToken);

        db.UserListSortPreferences.RemoveRange(existing);

        var statusIds = await db.ListStatuses
            .ToDictionaryAsync(s => s.Key, s => s.Id, cancellationToken);

        var rows = (dto.Sorts ?? [])
            .Where(sort => statusIds.ContainsKey(sort.Status))
            .GroupBy(sort => sort.Status)
            .Select(group => group.Last())
            .Select(sort => new UserListSortPreference
            {
                UserId = user.Id,
                StatusId = statusIds[sort.Status],
                SortKey = sort.SortKey,
                Descending = sort.Descending
            });

        await db.UserListSortPreferences.AddRangeAsync(rows, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    [HttpGet("hidden-platforms")]
    public async Task<ActionResult<IEnumerable<int>>> GetHiddenPlatforms(CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        var ids = await db.UserHiddenPlatforms
            .Where(hp => hp.UserId == user.Id)
            .Select(hp => hp.IgdbPlatformId)
            .ToListAsync(cancellationToken);

        return Ok(ids);
    }

    [HttpPut("hidden-platforms")]
    public async Task<IActionResult> UpdateHiddenPlatforms(
        [FromBody] UpdateHiddenPlatformsDto dto, CancellationToken cancellationToken)
    {
        var user = await userManager.GetUserAsync(User);
        if (user == null) return Unauthorized();

        var existing = await db.UserHiddenPlatforms
            .Where(hp => hp.UserId == user.Id)
            .ToListAsync(cancellationToken);

        db.UserHiddenPlatforms.RemoveRange(existing);

        var newEntries = dto.PlatformIds
            .Distinct()
            .Select(id => new UserHiddenPlatform { UserId = user.Id, IgdbPlatformId = id });

        await db.UserHiddenPlatforms.AddRangeAsync(newEntries, cancellationToken);
        await db.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    /// <summary>
    /// What the signed-in user has tracked and done, for their own profile.
    /// </summary>
    /// <remarks>
    /// The id comes from the claims principal rather than from a lookup, because that is all this
    /// needs — and from the principal rather than from the route, which is what keeps one user's
    /// figures out of another's response.
    /// </remarks>
    [HttpGet("stats")]
    public async Task<ActionResult<UserStatsDto>> GetStats(CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        return Ok(await stats.GetStatsAsync(userId, cancellationToken));
    }
}
