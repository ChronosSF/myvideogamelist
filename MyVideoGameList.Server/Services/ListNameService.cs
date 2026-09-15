using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and replaces what a user calls their five lists.
/// </summary>
/// <remarks>
/// A rename is a label: it writes <see cref="UserListSetting"/> and nothing else, and nothing reads
/// it but the owner's own pages. See <c>docs/decisions/0031-a-list-rename-is-a-label-its-owner-sees.md</c>.
/// </remarks>
public class ListNameService(ApplicationDbContext db) : IListNameService
{
    public async Task<IReadOnlyDictionary<string, string>> GetNamesAsync(
        string userId, CancellationToken cancellationToken = default) =>
        await db.UserListSettings
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .Join(db.ListStatuses, s => s.StatusId, status => status.Id, (s, status) => new { status.Key, s.DisplayName })
            .ToDictionaryAsync(x => x.Key, x => x.DisplayName, cancellationToken);

    public async Task<ListNamesResult> ReplaceAsync(
        string userId, IReadOnlyList<ListNameInputDto> names, CancellationToken cancellationToken = default)
    {
        var statuses = await db.ListStatuses
            .AsNoTracking()
            .OrderBy(s => s.SortOrder)
            .ToListAsync(cancellationToken);

        // The last name given for a status wins, as the last sort does — the client sends each list
        // once, and a repeat is a client bug rather than a reason to refuse the save.
        var requested = names
            .GroupBy(n => n.Status)
            .ToDictionary(group => group.Key, group => ListNamePolicy.Normalise(group.Last().Name));

        var custom = new Dictionary<string, string>();
        var errors = new Dictionary<string, string>();

        foreach (var status in statuses)
        {
            if (!requested.TryGetValue(status.Key, out var name) || name is null) continue;

            // Typing the default back in is a reset, not a rename. Compared exactly, so "FINISHED" is
            // a name somebody chose rather than the default spelled differently.
            if (name == status.DefaultName) continue;

            if (ListNamePolicy.Problem(name) is { } problem) errors[status.Key] = problem;
            else custom[status.Key] = name;
        }

        // Five names somebody can tell apart, defaults included, compared without case. Every list
        // caught in a clash that was renamed gets the message, so it lands beside whichever input the
        // user changed; a default is never blamed, because nobody typed it.
        var effective = statuses.ToDictionary(s => s.Key, s => custom.GetValueOrDefault(s.Key, s.DefaultName));
        foreach (var clash in effective.GroupBy(pair => pair.Value, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1))
        {
            foreach (var (key, name) in clash)
            {
                if (custom.ContainsKey(key))
                    errors.TryAdd(key, $"Another of your lists is already called \"{name}\".");
            }
        }

        if (errors.Count > 0) return new ListNamesResult(null, errors);

        // Replace wholesale, as the sort preferences do: the client owns the whole set and sends it,
        // so a list it left out goes back to its default by having no row.
        var existing = await db.UserListSettings
            .Where(s => s.UserId == userId)
            .ToListAsync(cancellationToken);
        db.UserListSettings.RemoveRange(existing);

        var ids = statuses.ToDictionary(s => s.Key, s => s.Id);
        db.UserListSettings.AddRange(custom.Select(pair => new UserListSetting
        {
            UserId = userId,
            StatusId = ids[pair.Key],
            DisplayName = pair.Value
        }));

        await db.SaveChangesAsync(cancellationToken);
        return new ListNamesResult(custom, new Dictionary<string, string>());
    }
}
