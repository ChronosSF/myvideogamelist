using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and writes a user's <see cref="Tag"/> rows and the <see cref="UserGameEntryTag"/> links that put
/// them on games.
/// </summary>
/// <remarks>
/// <para>
/// A service of its own rather than more methods on <see cref="ListService"/>, on the argument the
/// playthroughs were split out with: a tag shares nothing with list membership but the entry it hangs
/// off. Entries are still born in one place — the set-write goes through <see cref="EntryStore"/> — and
/// <see cref="EntryTagReader"/> is how the lists read the links.
/// </para>
/// <para>
/// <b>Nothing here writes a <see cref="UserGameEvent"/> or touches <see cref="UserGameEntry.StatusId"/>.</b>
/// A tag is not a status (ADR 0018), and putting one on a game is not a transition of anything.
/// </para>
/// <para>
/// No IGDB call on any path, and nothing here is read by anything public: no profile, community view or
/// sitemap mentions a tag (ADR 0065).
/// </para>
/// </remarks>
public class TagService(ApplicationDbContext db, TimeProvider clock) : ITagService
{
    /// <summary>
    /// How many times a write starts again from its read after a row it depended on moved underneath
    /// it — a tag deleted, a link added by another tab. Each attempt reads what is there now, so one
    /// retry is nearly always enough; the bound is there so a pathological run ends in an error rather
    /// than a loop.
    /// </summary>
    private const int MaxAttempts = 3;

    public async Task<IReadOnlyList<TagDto>> GetTagsAsync(
        string userId, CancellationToken cancellationToken = default)
    {
        var tags = await db.Tags
            .AsNoTracking()
            .Where(t => t.UserId == userId)
            .Select(t => new { t.Id, t.Name, t.NormalizedName })
            .ToListAsync(cancellationToken);

        var counts = await CountsAsync(userId, cancellationToken);

        // Ordered here, by the folded key, rather than by the database's collation — which the
        // in-memory provider the tests run on does not share. The client sorts again for display.
        return tags
            .OrderBy(t => t.NormalizedName, StringComparer.Ordinal)
            .ThenBy(t => t.Id)
            .Select(t => new TagDto(t.Id, t.Name, counts.GetValueOrDefault(t.Id)))
            .ToList();
    }

    public async Task<TagWriteResult> CreateAsync(
        string userId, string name, CancellationToken cancellationToken = default)
    {
        // The DTO's attribute has already refused all of these. Refused again here, as a sentence rather
        // than an exception, so that no caller can store a name the policy would not take.
        if (Tidied(name) is not { } normalised)
            return TagWriteResult.Refused(ValidTagNameAttribute.Check(name) ?? "A tag needs a name.");

        var key = TagNamePolicy.Key(normalised);

        // A name the account already has is that tag, whatever its spelling: the caller wanted a tag
        // called this, and now has one. That is what makes a create pressed twice, or sent from a tab
        // whose list of tags is out of date, an answer rather than an error.
        if (await FindByKeyAsync(userId, key, cancellationToken) is { } existing)
            return TagWriteResult.Saved(existing);

        var count = await db.Tags.CountAsync(t => t.UserId == userId, cancellationToken);
        if (count >= TagNamePolicy.MaxTagsPerAccount)
            return TagWriteResult.Refused(
                $"You have {TagNamePolicy.MaxTagsPerAccount} tags, which is as many as an account can hold. " +
                "Delete one you no longer use to make room.");

        var tag = new Tag
        {
            UserId = userId,
            Name = normalised,
            NormalizedName = key,
            CreatedAt = clock.GetUtcNow()
        };
        db.Tags.Add(tag);

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two requests can both pass the check above and only one insert can win the unique index
            // over (UserId, NormalizedName). Losing that race is the answer above, not a 500 — confirmed
            // by reading again rather than by matching a provider's error code, as GameAxisStore does,
            // so anything else is rethrown.
            db.Entry(tag).State = EntityState.Detached;

            if (await FindByKeyAsync(userId, key, cancellationToken) is { } winner)
                return TagWriteResult.Saved(winner);
            throw;
        }

        return TagWriteResult.Saved(new TagDto(tag.Id, tag.Name, 0), created: true);
    }

    public async Task<TagWriteResult> RenameAsync(
        string userId, int tagId, string name, CancellationToken cancellationToken = default)
    {
        if (Tidied(name) is not { } normalised)
            return TagWriteResult.Refused(ValidTagNameAttribute.Check(name) ?? "A tag needs a name.");

        var tag = await db.Tags
            .FirstOrDefaultAsync(t => t.UserId == userId && t.Id == tagId, cancellationToken);
        if (tag is null) return TagWriteResult.NotFound;

        var key = TagNamePolicy.Key(normalised);

        // Its own name in another letter case is a rename — it is how somebody fixes "Coop" to "co-op"'s
        // capitals — and cannot collide with anything. Another tag's name is refused rather than merged:
        // folding two tags into one is a different act, and doing it silently would be a surprise.
        if (await ClashAsync(userId, tagId, key, cancellationToken) is { } clash)
            return TagWriteResult.Refused($"You already have a tag called \"{clash}\".");

        tag.Name = normalised;
        tag.NormalizedName = key;

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Deleted by another request between the read and the write: the same answer as a tag that
            // was never there, rather than a 500 for one that has gone.
            return TagWriteResult.NotFound;
        }
        catch (DbUpdateException)
        {
            // Another tag took the name between the check and the write — two tabs. Confirmed by reading
            // again; anything else is rethrown.
            db.Entry(tag).State = EntityState.Detached;

            if (await ClashAsync(userId, tagId, key, cancellationToken) is { } winner)
                return TagWriteResult.Refused($"You already have a tag called \"{winner}\".");
            throw;
        }

        var count = await CountOfAsync(userId, tag.Id, cancellationToken);
        return TagWriteResult.Saved(new TagDto(tag.Id, tag.Name, count));
    }

    public async Task<bool> DeleteAsync(string userId, int tagId, CancellationToken cancellationToken = default)
    {
        for (var attempt = 1; ; attempt++)
        {
            var tag = await db.Tags
                .FirstOrDefaultAsync(t => t.UserId == userId && t.Id == tagId, cancellationToken);
            if (tag is null) return false;

            // Taken off every game in the same save, here, rather than left to the foreign key's cascade.
            // The cascade is still there and still the backstop for a link added after this read; doing it
            // here as well means the behaviour does not depend on which provider is underneath, which is
            // what lets a test say a deleted tag leaves no game carrying it.
            var links = await db.UserGameEntryTags
                .Where(l => l.UserId == userId && l.TagId == tagId)
                .ToListAsync(cancellationToken);

            db.UserGameEntryTags.RemoveRange(links);
            db.Tags.Remove(tag);

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return true;
            }
            catch (DbUpdateConcurrencyException) when (attempt < MaxAttempts)
            {
                // A row this meant to delete was already gone — the tag deleted by another request, or one
                // of its links taken off by a set-write. The save was rolled back whole, so start again
                // from what is there now; a tag that has gone answers false on the next pass.
                db.ChangeTracker.Clear();
            }
        }
    }

    public async Task<EntryTagsResult> SetEntryTagsAsync(
        string userId, int gameId, IReadOnlyCollection<int> tagIds, CancellationToken cancellationToken = default)
    {
        var wanted = tagIds.Distinct().ToList();

        // The DTO bounds the request already; the service bounds itself for any other caller.
        if (wanted.Count > TagNamePolicy.MaxTagsPerEntry)
            return EntryTagsResult.Refused($"A game can carry at most {TagNamePolicy.MaxTagsPerEntry} tags.");

        for (var attempt = 1; ; attempt++)
        {
            // Every id has to be one of this account's tags. The composite foreign key would refuse the
            // others anyway; checking here is what makes that a 400 beside the field instead of a 500,
            // and what refuses a tag somebody deleted in another tab. Refused whole, never filtered: a
            // set stored without one of its tags would be answered as saved while the client showed it.
            if (wanted.Count > 0)
            {
                var owned = await db.Tags
                    .AsNoTracking()
                    .CountAsync(t => t.UserId == userId && wanted.Contains(t.Id), cancellationToken);

                if (owned != wanted.Count)
                    return EntryTagsResult.Refused(
                        "One of those tags is not one of yours, or has been deleted. Reload the page and try again.");
            }

            // A set to hold creates the entry, as a score or an ownership does; clearing a game the user
            // has said nothing about creates nothing, because a row holding nothing would switch on the
            // game page's "delete my data" for it (ADR 0030 §5).
            var entry = wanted.Count > 0
                ? await EntryStore.FindOrCreateAsync(db, clock, userId, gameId, cancellationToken)
                : await db.UserGameEntries
                    .FirstOrDefaultAsync(e => e.UserId == userId && e.GameId == gameId, cancellationToken);

            if (entry is null) return EntryTagsResult.Saved;

            List<UserGameEntryTag> current = db.Entry(entry).State == EntityState.Added
                ? []
                : await db.UserGameEntryTags
                    .Where(l => l.UserId == userId && l.UserGameEntryId == entry.Id)
                    .ToListAsync(cancellationToken);

            // A diff rather than a delete and a re-insert, so a tag that stays keeps the moment it was
            // put on the game.
            var keep = wanted.ToHashSet();
            db.UserGameEntryTags.RemoveRange(current.Where(link => !keep.Contains(link.TagId)));

            var have = current.Select(link => link.TagId).ToHashSet();
            var now = clock.GetUtcNow();
            db.UserGameEntryTags.AddRange(wanted
                .Where(id => !have.Contains(id))
                .Select(id => new UserGameEntryTag
                {
                    UserId = userId,
                    // Through the navigation rather than by copying the key: a newly created entry has no
                    // Id until the save, and EF fills both halves of the composite foreign key in.
                    Entry = entry,
                    TagId = id,
                    AddedAt = now
                }));

            try
            {
                await db.SaveChangesAsync(cancellationToken);
                return EntryTagsResult.Saved;
            }
            catch (DbUpdateException) when (attempt < MaxAttempts)
            {
                // Something this write depended on moved between its read and its save: a link it meant to
                // remove was already gone, one it meant to add was added by another tab, a tag was deleted,
                // or two first writes for one game both created its entry. The save was rolled back whole,
                // so read again and diff against what is there now — which also re-checks the tags, so a
                // deleted one comes back as the refusal above rather than as a 500.
                db.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>The name as it will be stored, or null when it cannot be one.</summary>
    private static string? Tidied(string? name) =>
        ValidTagNameAttribute.Check(name) is null ? TagNamePolicy.Normalise(name) : null;

    private async Task<TagDto?> FindByKeyAsync(string userId, string key, CancellationToken cancellationToken)
    {
        var found = await db.Tags
            .AsNoTracking()
            .Where(t => t.UserId == userId && t.NormalizedName == key)
            .Select(t => new { t.Id, t.Name })
            .FirstOrDefaultAsync(cancellationToken);

        return found is null
            ? null
            : new TagDto(found.Id, found.Name, await CountOfAsync(userId, found.Id, cancellationToken));
    }

    /// <summary>The name of another of the account's tags folded to this key, or null when there is none.</summary>
    private Task<string?> ClashAsync(string userId, int tagId, string key, CancellationToken cancellationToken) =>
        db.Tags
            .AsNoTracking()
            .Where(t => t.UserId == userId && t.NormalizedName == key && t.Id != tagId)
            .Select(t => t.Name)
            .FirstOrDefaultAsync(cancellationToken);

    private Task<int> CountOfAsync(string userId, int tagId, CancellationToken cancellationToken) =>
        db.UserGameEntryTags.CountAsync(l => l.UserId == userId && l.TagId == tagId, cancellationToken);

    private async Task<Dictionary<int, int>> CountsAsync(string userId, CancellationToken cancellationToken) =>
        await db.UserGameEntryTags
            .AsNoTracking()
            .Where(l => l.UserId == userId)
            .GroupBy(l => l.TagId)
            .Select(g => new { TagId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.TagId, x => x.Count, cancellationToken);
}
