using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// What is coming that is connected to a user's games (<c>specs/release-timeline-and-calendar.md</c>
/// §3): the game itself on a new platform, its DLC and remasters, and the rest of its series.
/// </summary>
/// <remarks>
/// One service for every caller — the two-week line, the calendar, and #122's notifications, which will
/// ask the same question on a schedule rather than on request (§8.1).
/// </remarks>
public interface IConnectedReleaseService
{
    /// <summary>
    /// The user's connected releases in a window, grouped and each with its reason.
    /// </summary>
    /// <param name="to">Exclusive.</param>
    /// <param name="withPeriods">
    /// Also the releases known only to a month, quarter or year that overlaps the window; without it,
    /// only those known to the day.
    /// </param>
    Task<IReadOnlyList<ReleaseEntryDto>> GetAsync(
        string userId,
        DateOnly from,
        DateOnly to,
        bool withPeriods,
        CancellationToken cancellationToken = default);
}
