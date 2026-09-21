using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The pages this site asks to have indexed: the games somebody here tracks, and the profiles
/// their owners have published.
/// </summary>
/// <remarks>
/// <para>
/// <b>Games come from <c>CachedGames</c>, not from IGDB.</b> A page that only repeats what IGDB
/// says about a game is a page every other IGDB-backed site also has, and asking for the whole
/// catalogue to be indexed would be asking for that many copies. The games in the cache are the
/// ones a member has put on a list, a wishlist or a shelf of favourites — the pages that have, or
/// are about to have, something of ours on them. It also means listing them costs no IGDB call,
/// so the sitemap answers while IGDB does not. A tombstone is a game IGDB no longer has, whose
/// page is a 404, so it is left out.
/// </para>
/// <para>
/// <b>Membership names nobody.</b> A game being listed says that somebody here tracks it, never
/// who, and a private profile's games are in the cache beside everybody else's. That is the same
/// reading ADR 0028 gives an aggregate score, with the same caveat it records: at a handful of
/// members the set is small enough to be one person's library, unattributed.
/// </para>
/// <para>
/// <b>Profiles pass both gates the page itself has.</b> Public, because a private profile is a
/// 404 and listing its name would answer the question that 404 exists to refuse (ADR 0027). And
/// not empty, because a sitemap is a list of pages worth indexing, and the profile page marks an
/// empty one <c>noindex</c> — see <c>ProfilePage.tsx</c>, which has to agree with
/// <see cref="ListedProfiles"/> or a search console reports every disagreement as an error.
/// </para>
/// </remarks>
public class SitemapService(ApplicationDbContext db) : ISitemapService
{
    /// <summary>
    /// How many URLs one sitemap file carries. The protocol allows 50,000; a fifth of that keeps
    /// one response to well under a megabyte and costs nothing, because the index may name 50,000
    /// files.
    /// </summary>
    internal const int PageSize = 10_000;

    public async Task<SitemapSummaryDto> GetSummaryAsync(CancellationToken cancellationToken = default)
    {
        var games = await ListedGames().CountAsync(cancellationToken);
        var profiles = await ListedProfiles().CountAsync(cancellationToken);

        return new SitemapSummaryDto(games, profiles, PageSize);
    }

    public async Task<IReadOnlyList<int>> GetGameIdsAsync(
        int page, CancellationToken cancellationToken = default)
    {
        if (OffsetFor(page) is not { } offset) return [];

        return await ListedGames()
            // By the key, so a file's contents do not depend on the order the database happens to
            // return rows in, and a game added later lands at the end of the last file.
            .OrderBy(g => g.GameId)
            .Skip(offset)
            .Take(PageSize)
            .Select(g => g.GameId)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<string>> GetProfileNamesAsync(
        int page, CancellationToken cancellationToken = default)
    {
        if (OffsetFor(page) is not { } offset) return [];

        return await ListedProfiles()
            // By the account id rather than the name: a rename then changes one line of one file
            // instead of moving the account, and everybody after it, to a different one.
            .OrderBy(u => u.Id)
            .Skip(offset)
            .Take(PageSize)
            .Select(u => u.UserName!)
            .ToListAsync(cancellationToken);
    }

    private IQueryable<CachedGame> ListedGames() =>
        db.CachedGames
            .AsNoTracking()
            .Where(g => g.Payload != null);

    private IQueryable<ApplicationUser> ListedProfiles() =>
        db.Users
            .AsNoTracking()
            .Where(u => u.ProfileVisibility == ProfileVisibility.Public && u.UserName != null)
            // Anything at all recorded, or a favourite, which needs no entry (ADR 0029). A review
            // hangs off an entry, so it is already counted.
            .Where(u => db.UserGameEntries.Any(e => e.UserId == u.Id)
                || db.UserFavourites.Any(f => f.UserId == u.Id));

    /// <summary>
    /// Where a page starts, or null when it starts past anything an <c>int</c> can skip to. The
    /// page arrives validated to be positive, not to be small, and <c>int.MaxValue</c> times the
    /// page size overflows into a negative offset that PostgreSQL refuses.
    /// </summary>
    private static int? OffsetFor(int page)
    {
        var offset = (long)(Math.Max(page, 1) - 1) * PageSize;
        return offset > int.MaxValue ? null : (int)offset;
    }
}
