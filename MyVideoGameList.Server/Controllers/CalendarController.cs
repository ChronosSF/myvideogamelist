using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Controllers;

/// <summary>
/// The showcases and sales beside somebody's releases on the two-week line and the calendar
/// (<c>specs/release-timeline-and-calendar.md</c> §8.2, B2).
/// </summary>
/// <remarks>
/// Anonymous, because it is the same for everybody and says nothing about anybody: the line and the calendar
/// ask it beside <c>/api/user/releases</c>. A visitor with no line has the same answer through
/// <c>/api/home</c> instead (ADR 0063). The service keeps IGDB's part once for everybody; nothing in front of
/// the API keeps a copy, since the edge caches nothing under <c>/api/</c> (ADR 0044).
/// </remarks>
[ApiController]
[Route("api/calendar")]
public class CalendarController(ICalendarEventService events) : ControllerBase
{
    [HttpGet("events")]
    public async Task<ActionResult<CalendarEventsDto>> GetEvents(
        [FromQuery] CalendarWindowQuery window,
        CancellationToken cancellationToken)
    {
        // Both are set: [Required] has already refused a window missing either end.
        var from = window.From ?? throw new ArgumentException("The window needs its first day.", nameof(window));
        var to = window.To ?? throw new ArgumentException("The window needs its last day.", nameof(window));

        return Ok(await events.GetAsync(from, to, cancellationToken));
    }
}
