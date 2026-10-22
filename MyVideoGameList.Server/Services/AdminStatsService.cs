using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// What members do on the site, counted from its own tables for the admin page (ADR 0051).
/// </summary>
/// <remarks>
/// <para>
/// Every figure is a count over all accounts. Nothing here selects an account, a name or anything
/// one member wrote, and nothing should: profiles are private by default (ADR 0027), and the admin
/// pages edit reference data, never a member's (ADR 0042). A figure that needs one member's data to
/// explain itself does not belong on the page.
/// </para>
/// <para>
/// No third party and no tracking: it is all read from rows the site already keeps, plus the two
/// dates on each account that exist for this. Read-only and uncached, like the stats a member sees
/// of their own (ADR 0023): an admin loading the page wants it as it is now.
/// </para>
/// </remarks>
public class AdminStatsService(ApplicationDbContext db, TimeProvider clock) : IAdminStatsService
{
    /// <summary>How many weeks the page shows, the current one included.</summary>
    internal const int WeekCount = 12;

    public async Task<AdminStatsDto> GetAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);

        return new AdminStatsDto(
            now,
            await AccountsAsync(today, cancellationToken),
            await LibraryAsync(cancellationToken),
            await WritingAsync(cancellationToken),
            await ImportsAsync(cancellationToken),
            await WeeksAsync(today, cancellationToken));
    }

    /// <summary>The Monday a day's week starts on.</summary>
    internal static DateOnly WeekStarting(DateOnly day) => day.AddDays(-(((int)day.DayOfWeek + 6) % 7));

    private static DateTimeOffset Midnight(DateOnly day) => new(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);

    private async Task<AdminAccountStatsDto> AccountsAsync(DateOnly today, CancellationToken cancellationToken)
    {
        // A last-seen date is written once a UTC day, so the windows are whole days: today, and today
        // with the six or twenty-nine before it.
        var sinceToday = Midnight(today);
        var sinceSevenDays = Midnight(today.AddDays(-6));
        var sinceThirtyDays = Midnight(today.AddDays(-29));
        var users = db.Users.AsNoTracking();

        return new AdminAccountStatsDto(
            Total: await users.CountAsync(cancellationToken),
            PublicProfiles: await users.CountAsync(u => u.ProfileVisibility == ProfileVisibility.Public, cancellationToken),
            SeenToday: await users.CountAsync(u => u.LastSeenAt >= sinceToday, cancellationToken),
            SeenInSevenDays: await users.CountAsync(u => u.LastSeenAt >= sinceSevenDays, cancellationToken),
            SeenInThirtyDays: await users.CountAsync(u => u.LastSeenAt >= sinceThirtyDays, cancellationToken),
            Undated: await users.CountAsync(u => u.CreatedAt == null, cancellationToken));
    }

    private async Task<AdminLibraryStatsDto> LibraryAsync(CancellationToken cancellationToken)
    {
        var entries = db.UserGameEntries.AsNoTracking();
        var counts = await entries
            .Where(e => e.StatusId != null)
            .GroupBy(e => e.StatusId)
            .Select(g => new { StatusId = g.Key, Count = g.Count() })
            .ToListAsync(cancellationToken);
        var statuses = await db.ListStatuses
            .AsNoTracking()
            .OrderBy(s => s.SortOrder)
            .Select(s => new { s.Id, s.Key })
            .ToListAsync(cancellationToken);

        // Every list is named, an empty one with a nought, so that a list nobody uses yet still shows.
        var byStatus = new Dictionary<string, int>();
        foreach (var status in statuses)
            byStatus[status.Key] = counts.FirstOrDefault(c => c.StatusId == status.Id)?.Count ?? 0;

        return new AdminLibraryStatsDto(
            byStatus,
            InNoList: await entries.CountAsync(e => e.StatusId == null, cancellationToken),
            FromImports: await entries.CountAsync(e => e.Origin != EntryOrigins.Manual, cancellationToken),
            Wishlisted: await db.UserWishlistItems.CountAsync(cancellationToken),
            Favourites: await db.UserFavourites.CountAsync(cancellationToken));
    }

    private async Task<AdminWritingStatsDto> WritingAsync(CancellationToken cancellationToken) =>
        new(
            Reviews: await db.Reviews.CountAsync(cancellationToken),
            PublicReviews: await db.Reviews.CountAsync(r => r.Visibility == ReviewVisibility.Public, cancellationToken),
            Playthroughs: await db.UserGamePlaythroughs.CountAsync(cancellationToken),
            TimedPlaythroughs: await db.UserGamePlaythroughs.CountAsync(p => p.MinutesPlayed != null, cancellationToken));

    private async Task<AdminImportStatsDto> ImportsAsync(CancellationToken cancellationToken) =>
        new(
            Pending: await db.ImportJobs.CountAsync(j => j.State == ImportJobStates.Pending, cancellationToken),
            Done: await db.ImportJobs.CountAsync(j => j.State == ImportJobStates.Done, cancellationToken),
            Cancelled: await db.ImportJobs.CountAsync(j => j.State == ImportJobStates.Cancelled, cancellationToken));

    /// <remarks>
    /// Reads the moments themselves for the twelve weeks and counts them here, which keeps the query
    /// the same on every provider. At this site's size that is a few thousand timestamps; group them in
    /// the database the day it is not.
    /// </remarks>
    private async Task<IReadOnlyList<AdminWeekStatsDto>> WeeksAsync(DateOnly today, CancellationToken cancellationToken)
    {
        var first = WeekStarting(today).AddDays(-7 * (WeekCount - 1));
        var since = Midnight(first);

        var signUps = await db.Users.AsNoTracking()
            .Where(u => u.CreatedAt >= since).Select(u => u.CreatedAt!.Value).ToListAsync(cancellationToken);
        var moves = await db.UserGameEvents.AsNoTracking()
            .Where(e => e.OccurredAt >= since).Select(e => e.OccurredAt).ToListAsync(cancellationToken);
        var reviews = await db.Reviews.AsNoTracking()
            .Where(r => r.CreatedAt >= since).Select(r => r.CreatedAt).ToListAsync(cancellationToken);
        var playthroughs = await db.UserGamePlaythroughs.AsNoTracking()
            .Where(p => p.CreatedAt >= since).Select(p => p.CreatedAt).ToListAsync(cancellationToken);

        static Dictionary<DateOnly, int> ByWeek(List<DateTimeOffset> moments) => moments
            .GroupBy(m => WeekStarting(DateOnly.FromDateTime(m.UtcDateTime)))
            .ToDictionary(g => g.Key, g => g.Count());

        var (signUpWeeks, moveWeeks, reviewWeeks, playthroughWeeks) =
            (ByWeek(signUps), ByWeek(moves), ByWeek(reviews), ByWeek(playthroughs));

        return Enumerable.Range(0, WeekCount)
            .Select(i => first.AddDays(7 * i))
            .Select(starts => new AdminWeekStatsDto(
                starts,
                signUpWeeks.GetValueOrDefault(starts),
                moveWeeks.GetValueOrDefault(starts),
                reviewWeeks.GetValueOrDefault(starts),
                playthroughWeeks.GetValueOrDefault(starts)))
            .ToList();
    }
}
