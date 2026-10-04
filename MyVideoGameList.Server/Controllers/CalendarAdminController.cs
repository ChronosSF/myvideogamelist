using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Security;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The admin page's side of the release calendar: the store sales and other dates entered by hand,
/// and the names that make an IGDB event a showcase (<c>specs/release-timeline-and-calendar.md</c> §7).
/// </summary>
/// <remarks>
/// <para>
/// Every action sits behind <see cref="AdminPolicy"/>, from the class, so an action added later is
/// guarded without anybody remembering to guard it. None may carry <see cref="AllowAnonymousAttribute"/>,
/// and a test says so.
/// </para>
/// <para>
/// <c>no-store</c> on everything: these answers go to one person, and the writes are the only way
/// they change, so a copy kept anywhere between here and that person could only ever be stale.
/// </para>
/// </remarks>
[ApiController]
[Route("api/admin/calendar")]
[Authorize(Policy = AdminPolicy.Name)]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class CalendarAdminController(ICalendarCurationService curation) : ControllerBase
{
    [HttpGet("events")]
    public async Task<ActionResult<IReadOnlyList<CuratedEventDto>>> ListEvents(CancellationToken cancellationToken) =>
        Ok(await curation.ListEventsAsync(cancellationToken));

    [HttpPost("events")]
    public async Task<ActionResult<CuratedEventDto>> AddEvent(
        [FromBody] CuratedEventInputDto input,
        CancellationToken cancellationToken) =>
        Ok(await curation.AddEventAsync(input, cancellationToken));

    /// <summary>Replaces an event whole, which is what the page's edit form sends.</summary>
    [HttpPut("events/{id:int}")]
    public async Task<ActionResult<CuratedEventDto>> ReplaceEvent(
        [Range(1, int.MaxValue)] int id,
        [FromBody] CuratedEventInputDto input,
        CancellationToken cancellationToken)
    {
        var saved = await curation.ReplaceEventAsync(id, input, cancellationToken);
        return saved is null ? NotFound() : Ok(saved);
    }

    [HttpDelete("events/{id:int}")]
    public async Task<IActionResult> RemoveEvent(
        [Range(1, int.MaxValue)] int id,
        CancellationToken cancellationToken) =>
        await curation.RemoveEventAsync(id, cancellationToken) ? NoContent() : NotFound();

    [HttpGet("showcase-names")]
    public async Task<ActionResult<IReadOnlyList<ShowcaseNameDto>>> ListShowcaseNames(
        CancellationToken cancellationToken) =>
        Ok(await curation.ListShowcaseNamesAsync(cancellationToken));

    /// <remarks>
    /// A name already on the list is refused as a problem with the field, the shape a taken username
    /// is refused in, so the form can say so beside the box it was typed into.
    /// </remarks>
    [HttpPost("showcase-names")]
    public async Task<ActionResult<ShowcaseNameDto>> AddShowcaseName(
        [FromBody] ShowcaseNameInputDto input,
        CancellationToken cancellationToken)
    {
        var added = await curation.AddShowcaseNameAsync(input.Prefix, cancellationToken);
        if (added is not null) return Ok(added);

        ModelState.AddModelError(nameof(ShowcaseNameInputDto.Prefix), "That name is already on the list.");
        return ValidationProblem(ModelState);
    }

    [HttpDelete("showcase-names/{id:int}")]
    public async Task<IActionResult> RemoveShowcaseName(
        [Range(1, int.MaxValue)] int id,
        CancellationToken cancellationToken) =>
        await curation.RemoveShowcaseNameAsync(id, cancellationToken) ? NoContent() : NotFound();
}
