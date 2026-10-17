using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The tag ids on a user's entries, for the rows that carry them.
/// </summary>
/// <remarks>
/// <para>
/// Ids and nothing else. The names come from <c>/api/tags</c>, once per sign-in, so a rename is one row
/// there and the lists never have to be told (ADR 0065).
/// </para>
/// <para>
/// Scoped on the link's own <c>UserId</c>, in the predicate, like every read of a user's rows. The
/// composite foreign key makes that the same account as the entry's, but the predicate is the
/// authorization boundary and belongs where it can be read.
/// </para>
/// </remarks>
internal static class EntryTagReader
{
    /// <summary>Every entry of the account that carries a tag, to its tag ids in id order.</summary>
    public static async Task<IReadOnlyDictionary<int, IReadOnlyList<int>>> ByEntryAsync(
        ApplicationDbContext db, string userId, CancellationToken cancellationToken)
    {
        var links = await db.UserGameEntryTags
            .AsNoTracking()
            .Where(l => l.UserId == userId)
            .Select(l => new { l.UserGameEntryId, l.TagId })
            .ToListAsync(cancellationToken);

        return links
            .GroupBy(l => l.UserGameEntryId)
            .ToDictionary(
                group => group.Key,
                group => (IReadOnlyList<int>)group.Select(l => l.TagId).Order().ToList());
    }

    /// <summary>One entry's tag ids, in id order; empty when it carries none.</summary>
    public static async Task<IReadOnlyList<int>> ForEntryAsync(
        ApplicationDbContext db, string userId, int entryId, CancellationToken cancellationToken) =>
        await db.UserGameEntryTags
            .AsNoTracking()
            .Where(l => l.UserId == userId && l.UserGameEntryId == entryId)
            .OrderBy(l => l.TagId)
            .Select(l => l.TagId)
            .ToListAsync(cancellationToken);
}
