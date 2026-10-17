using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The signed-in user's tags: the words they file their games under, and nobody else's.
/// </summary>
/// <remarks>
/// <para>
/// Putting tags on a game is <c>PUT /api/entries/{gameId}/tags</c>, beside the entry's other fields; this
/// is the vocabulary itself — what exists, what it is called, and how many games carry each.
/// </para>
/// <para>
/// <c>no-store</c> on everything, like every answer about one person: nothing between here and the
/// browser should keep one account's tags for the next. Every write goes through the write guard like any
/// other, and a refused name comes back as a <see cref="ValidationProblemDetails"/> beside the field. See
/// ADR 0065.
/// </para>
/// </remarks>
[ApiController]
[Route("api/[controller]")]
[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class TagsController(ITagService tags, UserManager<ApplicationUser> userManager) : ControllerBase
{
    /// <summary>Every tag of the account, with how many games carry each, in name order.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TagDto>>> GetTags(CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        return Ok(await tags.GetTagsAsync(userId, cancellationToken));
    }

    /// <summary>
    /// Makes a tag, or answers with the one the account already has under that name in any letter case.
    /// </summary>
    /// <remarks>
    /// 201 when it made one, 200 when it found one: either way the caller now has a tag called this. That
    /// is what makes a tab whose list of tags is out of date, or a press sent twice, an answer rather than
    /// an error. The shape of the name is settled by <c>[ValidTagName]</c> before this runs; what is left
    /// is the account's cap, which comes back beside the field.
    /// </remarks>
    [HttpPost]
    public async Task<ActionResult<TagDto>> CreateTag(
        [FromBody] TagNameDto dto, CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        var result = await tags.CreateAsync(userId, dto.Name, cancellationToken);
        if (result.Problem is { } problem) return Refused(nameof(TagNameDto.Name), problem);

        return result.Created
            ? CreatedAtAction(nameof(GetTags), null, result.Tag)
            : Ok(result.Tag);
    }

    /// <summary>Renames one of the account's tags. Every game it is on keeps it.</summary>
    [HttpPut("{tagId:int}")]
    public async Task<ActionResult<TagDto>> RenameTag(
        [Range(1, int.MaxValue)] int tagId,
        [FromBody] TagNameDto dto,
        CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        var result = await tags.RenameAsync(userId, tagId, dto.Name, cancellationToken);

        // Another account's tag is simply not found, so this says nothing about whether the id exists.
        if (result.Missing) return NotFound();
        if (result.Problem is { } problem) return Refused(nameof(TagNameDto.Name), problem);

        return Ok(result.Tag);
    }

    /// <summary>Deletes one of the account's tags, and takes it off every game that carries it.</summary>
    [HttpDelete("{tagId:int}")]
    public async Task<IActionResult> DeleteTag(
        [Range(1, int.MaxValue)] int tagId,
        CancellationToken cancellationToken)
    {
        var userId = userManager.GetUserId(User);
        if (userId is null) return Unauthorized();

        return await tags.DeleteAsync(userId, tagId, cancellationToken) ? NoContent() : NotFound();
    }

    /// <summary>A refusal the service decided, in the shape every other 400 here takes.</summary>
    private ActionResult Refused(string field, string problem)
    {
        ModelState.AddModelError(field, problem);
        return ValidationProblem(ModelState);
    }
}
