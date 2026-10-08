using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The showcases and sales the two-week line and the calendar show beside somebody's releases
/// (<c>specs/release-timeline-and-calendar.md</c> §5, §6 and B2): the same for everybody.
/// </summary>
/// <remarks>
/// Only reads the admin page's two tables — what the page writes is <see cref="ICalendarCurationService"/>'s
/// business, behind the admin policy.
/// </remarks>
public interface ICalendarEventService
{
    /// <param name="to">Exclusive.</param>
    Task<CalendarEventsDto> GetAsync(DateOnly from, DateOnly to, CancellationToken cancellationToken = default);
}
