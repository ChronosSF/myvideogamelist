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
    SignInManager<ApplicationUser> signInManager,
    ApplicationDbContext db,
    IStatsService stats,
    IUserDataExporter exporter,
    TimeProvider clock) : ControllerBase
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
    /// How long an account must wait between renames.
    /// </summary>
    /// <remarks>
    /// A username is a public address. Renaming breaks every link to the old one and releases it
    /// for somebody else to claim, so a stream of renames is both how links rot and how a namespace
    /// gets churned by a squatter cycling names. Thirty days is long enough to make that pointless
    /// and short enough that somebody who mistyped their name at signup is not stuck with it for a
    /// year. The first choice is free: <c>UserNameChangedAt</c> is null until the first rename.
    /// </remarks>
    private static readonly TimeSpan RenameCooldown = TimeSpan.FromDays(30);

    /// <summary>
    /// Claims a different username.
    /// </summary>
    /// <remarks>
    /// <para>
    /// The shape and the reserved list are settled by <c>[UserName]</c> before this runs. What is
    /// left are the two things an attribute cannot know: whether the name is free, and whether this
    /// account is allowed to change again yet. Both come back as a
    /// <see cref="ValidationProblemDetails"/> naming the field, so they land beside the input the
    /// same way a malformed name does.
    /// </para>
    /// <para>
    /// Availability is never checked separately before the write. A "is it free" query followed by
    /// an update is two statements with a gap in between, and the gap is exactly where two people
    /// claiming the same name at once both get told yes. The unique index over
    /// <c>NormalizedUserName</c> settles it, and <c>SetUserNameAsync</c> reports the loser's failure
    /// as <c>DuplicateUserName</c>.
    /// </para>
    /// </remarks>
    [HttpPut("username")]
    public async Task<ActionResult<UserProfileDto>> UpdateUserName([FromBody] UpdateUserNameDto dto)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        // Renaming to what you already are is not a rename, and must not start a cooldown. The
        // comparison is case-insensitive because the namespace is: `Alex` and `alex` are one name.
        if (string.Equals(user.UserName, dto.UserName, StringComparison.OrdinalIgnoreCase))
        {
            // A change of letter case is a change worth allowing — it is how somebody fixes a name
            // they capitalised wrongly — and it cannot collide with anybody, so it skips the
            // cooldown as well.
            if (user.UserName != dto.UserName)
            {
                user.UserName = dto.UserName;
                await userManager.UpdateAsync(user);
            }

            return Ok(Profile(user));
        }

        if (user.UserNameChangedAt is DateTimeOffset last)
        {
            var free = last + RenameCooldown;
            if (clock.GetUtcNow() < free)
            {
                ModelState.AddModelError(
                    nameof(UpdateUserNameDto.UserName),
                    $"You can change your username again on {free.UtcDateTime:d MMMM yyyy}.");
                return ValidationProblem(ModelState);
            }
        }

        var previous = user.UserName;
        user.UserNameChangedAt = clock.GetUtcNow();

        var result = await userManager.SetUserNameAsync(user, dto.UserName);
        if (!result.Succeeded)
        {
            // Nothing was written, but the in-memory user was mutated on the way here, so the
            // timestamp is put back rather than left to be picked up by an unrelated later save.
            user.UserNameChangedAt = null;
            user.UserName = previous;

            ModelState.AddModelError(
                nameof(UpdateUserNameDto.UserName),
                result.Errors.Any(e => e.Code == nameof(IdentityErrorDescriber.DuplicateUserName))
                    ? "That username is taken."
                    : string.Join(" ", result.Errors.Select(e => e.Description)));

            return ValidationProblem(ModelState);
        }

        return Ok(Profile(user));
    }

    /// <summary>
    /// Turns the public profile at <c>/u/{userName}</c> on or off.
    /// </summary>
    /// <remarks>
    /// Its own endpoint rather than a field on a general settings update, because it is the one
    /// preference here whose effect is on other people. Turning it off does not delete anything: a
    /// private profile is a 404 to every reader, and turning it back on restores the same page.
    /// </remarks>
    [HttpPut("privacy")]
    public async Task<ActionResult<UserProfileDto>> UpdatePrivacy(
        [FromBody] UpdateProfileVisibilityDto dto)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        user.ProfileVisibility = dto.ProfileVisibility;
        await userManager.UpdateAsync(user);

        return Ok(Profile(user));
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

    /// <summary>
    /// Everything the signed-in user has entered, as one JSON document.
    /// </summary>
    /// <remarks>
    /// Free, and it stays free — data portability is a right rather than a feature, so it must not
    /// sit behind a subscription. The paid export in the monetisation table is a nicer
    /// <em>format</em> on top of this one (CSV, re-importable), not access to the data itself. See
    /// <c>docs/decisions/0024-the-ownership-contract.md</c>.
    /// </remarks>
    [HttpGet("export")]
    public async Task<ActionResult<UserDataExportDto>> Export(CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        // So a browser saves the document instead of rendering it in a tab. Still
        // application/json — this says what to do with the body, not what the body is. The
        // filename is fixed rather than stamped with the date, because the document carries
        // `exportedAt` and a browser deduplicates repeat downloads for us.
        Response.Headers.ContentDisposition = "attachment; filename=\"myvideogamelist-export.json\"";

        return Ok(await exporter.ExportAsync(userId, cancellationToken));
    }

    /// <summary>
    /// Deletes the signed-in user's account, and with it everything they have entered.
    /// </summary>
    /// <remarks>
    /// <para>
    /// One <c>DeleteAsync</c>, deliberately. Every user-owned table cascades from
    /// <c>AspNetUsers</c> through its own <c>UserId</c> column, so the account row going away takes
    /// the entries, the event log, the wishlist, the hidden platforms and the sort preferences with
    /// it — in one transaction, with no list of tables here to fall out of date. What makes that
    /// safe is not this method but the model: <c>UserOwnedDataTests</c> fails the build if a
    /// user-owned entity is ever added without that cascade. See
    /// <c>docs/decisions/0024-the-ownership-contract.md</c>.
    /// </para>
    /// <para>
    /// No cancellation token: <see cref="UserManager{TUser}"/> takes none, and a deletion abandoned
    /// halfway is not a state worth inviting. Matches <see cref="UpdateTheme"/>, which is likewise
    /// a single Identity write.
    /// </para>
    /// </remarks>
    [HttpDelete]
    public async Task<IActionResult> DeleteAccount([FromBody] DeleteAccountDto dto)
    {
        var user = await userManager.GetUserAsync(User);
        if (user is null) return Unauthorized();

        // The confirmation. A valid cookie says this browser signed in at some point; the password
        // says the account holder is here now, which is the bar an irreversible act should clear.
        if (!await userManager.CheckPasswordAsync(user, dto.Password))
            return Unauthorized(new { message = "Password is incorrect." });

        var result = await userManager.DeleteAsync(user);
        if (!result.Succeeded)
            return Problem(string.Join(" ", result.Errors.Select(e => e.Description)));

        // The account is gone, so the cookie now authenticates nothing. Clearing it here saves the
        // client from holding a credential for a user that cannot be looked up.
        await signInManager.SignOutAsync();

        return NoContent();
    }

    /// <summary>
    /// The same projection <c>AuthController</c> returns, so an endpoint that changes part of the
    /// profile hands back the whole of it in the shape the client already holds.
    /// </summary>
    private static UserProfileDto Profile(ApplicationUser user) =>
        new(user.Id, user.Email!, user.UserName!, user.Theme, user.ProfileVisibility);
}
