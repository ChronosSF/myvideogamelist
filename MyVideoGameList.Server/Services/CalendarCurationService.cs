using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

public class CalendarCurationService(ApplicationDbContext db, TimeProvider clock) : ICalendarCurationService
{
    public async Task<IReadOnlyList<CuratedEventDto>> ListEventsAsync(CancellationToken cancellationToken = default) =>
        await db.CuratedEvents
            .AsNoTracking()
            .OrderBy(e => e.StartsOn)
            .ThenBy(e => e.Name)
            .Select(e => new CuratedEventDto(e.Id, e.Kind, e.Store, e.Name, e.StartsOn, e.EndsOn, e.Url, e.UpdatedAt))
            .ToListAsync(cancellationToken);

    public async Task<CuratedEventDto> AddEventAsync(
        CuratedEventInputDto input, CancellationToken cancellationToken = default)
    {
        var now = clock.GetUtcNow();

        // The members the type requires, then Apply exactly as for a replacement, so that how an
        // input is stored is written in one place.
        var added = new CuratedEvent { Kind = input.Kind, Name = input.Name, Url = input.Url, CreatedAt = now };
        Apply(added, input, now);

        db.CuratedEvents.Add(added);
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(added);
    }

    public async Task<CuratedEventDto?> ReplaceEventAsync(
        int id, CuratedEventInputDto input, CancellationToken cancellationToken = default)
    {
        var existing = await db.CuratedEvents.FindAsync([id], cancellationToken);
        if (existing is null) return null;

        Apply(existing, input, clock.GetUtcNow());

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Removed by another request between the read and the write — the page open in two tabs.
            // The same answer as an id that never existed, rather than a 500 for an event that is gone.
            return null;
        }

        return ToDto(existing);
    }

    public async Task<bool> RemoveEventAsync(int id, CancellationToken cancellationToken = default) =>
        await RemoveAsync(await db.CuratedEvents.FindAsync([id], cancellationToken), cancellationToken);

    public async Task<IReadOnlyList<ShowcaseNameDto>> ListShowcaseNamesAsync(
        CancellationToken cancellationToken = default) =>
        await db.ShowcaseNames
            .AsNoTracking()
            .OrderBy(n => n.Prefix)
            .Select(n => new ShowcaseNameDto(n.Id, n.Prefix))
            .ToListAsync(cancellationToken);

    public async Task<ShowcaseNameDto?> AddShowcaseNameAsync(
        string prefix, CancellationToken cancellationToken = default)
    {
        var wanted = Tidy(prefix);
        if (await IsListedAsync(wanted, cancellationToken)) return null;

        var added = new ShowcaseName { Prefix = wanted };
        db.ShowcaseNames.Add(added);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // The check above and the unique index disagree only when two requests add the same name
            // at once — a form submitted twice. Confirmed by reading again rather than by matching a
            // provider's error code, as GameAxisStore does, so anything else is rethrown.
            db.Entry(added).State = EntityState.Detached;
            if (await IsListedAsync(wanted, cancellationToken)) return null;
            throw;
        }

        return new ShowcaseNameDto(added.Id, added.Prefix);
    }

    public async Task<bool> RemoveShowcaseNameAsync(int id, CancellationToken cancellationToken = default) =>
        await RemoveAsync(await db.ShowcaseNames.FindAsync([id], cancellationToken), cancellationToken);

    /// <summary>
    /// False for a row that is not there, including one another request removed after it was read —
    /// a delete clicked twice — which EF reports as a concurrency failure and would otherwise be a 500.
    /// </summary>
    private async Task<bool> RemoveAsync<T>(T? row, CancellationToken cancellationToken) where T : class
    {
        if (row is null) return false;

        db.Remove(row);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }
    }

    /// <summary>
    /// Compared in memory rather than in SQL: the table is a dozen rows, and this way case is ignored
    /// exactly as the match against IGDB's event names will ignore it.
    /// </summary>
    private async Task<bool> IsListedAsync(string prefix, CancellationToken cancellationToken)
    {
        var listed = await db.ShowcaseNames.AsNoTracking().Select(n => n.Prefix).ToListAsync(cancellationToken);
        return listed.Any(name => string.Equals(name, prefix, StringComparison.OrdinalIgnoreCase));
    }

    private static void Apply(CuratedEvent target, CuratedEventInputDto input, DateTimeOffset now)
    {
        target.Kind = input.Kind;
        target.Store = input.Store;
        target.Name = Tidy(input.Name);

        // Model validation has already refused a missing day; this is for a caller that skipped it.
        target.StartsOn = input.StartsOn ?? throw new ArgumentException("An event needs its first day.", nameof(input));
        target.EndsOn = input.EndsOn ?? throw new ArgumentException("An event needs its last day.", nameof(input));

        target.Url = input.Url.Trim();
        target.UpdatedAt = now;
    }

    /// <summary>
    /// Trimmed, with runs of whitespace as one space: a name pasted from an announcement often carries
    /// a line break, and a prefix with a trailing space would stop matching the show it names.
    /// </summary>
    private static string Tidy(string text) =>
        string.Join(' ', text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static CuratedEventDto ToDto(CuratedEvent e) =>
        new(e.Id, e.Kind, e.Store, e.Name, e.StartsOn, e.EndsOn, e.Url, e.UpdatedAt);
}
