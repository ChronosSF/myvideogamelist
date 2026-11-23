using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// What a public profile shows, as the rows behind it: the one place that decides which entries a
/// public figure counts, and which profiles have anything on them at all.
/// </summary>
/// <remarks>
/// <para>
/// <b>An entry counts publicly only when it holds something the page shows</b>: a status, a score, a
/// playthrough, or a review published on it. Notes and an ownership are the owner's alone (ADR 0030
/// §3), and so are tags (ADR 0065 §7) and a private review; an entry holding nothing else is a fact
/// nobody published. Counting it would let a private act move a public number, and could turn an
/// empty profile into a listed one, so it is left out of both (#346). The owner's own statistics still
/// count every entry: <see cref="StatsService"/> reads the table and not this.
/// </para>
/// <para>
/// <b>One test of an empty profile, run in two places.</b> The sitemap lists
/// <see cref="ListedProfiles"/>, and the public profile carries whether its account is among them, so
/// the page marks <c>noindex</c> exactly the profiles the sitemap leaves out rather than restating the
/// test in TypeScript. A sitemap that lists a page marked <c>noindex</c> is an error in every search
/// console (ADR 0036 §4).
/// </para>
/// <para>
/// Queries rather than predicates, so that every caller composes the same SQL: EF inlines a captured
/// <see cref="IQueryable{T}"/> as a subquery. None says <c>AsNoTracking</c>, since each is also a
/// subquery of another; a caller that reads entities says it. PostgreSQL runs them in the integration
/// suite's <c>PublicFiguresFlowTests</c>.
/// </para>
/// </remarks>
internal static class PublicProfileContent
{
    /// <summary>
    /// Every review a public profile shows, of every account: public, and not hidden by an admin
    /// (ADR 0076). Whether the profile itself is public is the caller's gate.
    /// </summary>
    public static IQueryable<Review> PublishedReviews(ApplicationDbContext db) =>
        db.Reviews
            .Where(r => r.Visibility == ReviewVisibility.Public && r.HiddenAt == null);

    /// <summary>
    /// Every entry, of every account, that holds something a public profile shows. Scope it to one
    /// account with a further <c>Where</c> on <see cref="UserGameEntry.UserId"/>.
    /// </summary>
    public static IQueryable<UserGameEntry> ShownEntries(ApplicationDbContext db)
    {
        var published = PublishedReviews(db);

        // Keyed on the entry alone: a playthrough and a review reach their entry by a composite key
        // that includes the owner (ADR 0025 §3), so one with this entry's id is this entry's owner's.
        return db.UserGameEntries
            .Where(e => e.StatusId != null
                || e.Score != null
                || db.UserGamePlaythroughs.Any(p => p.UserGameEntryId == e.Id)
                || published.Any(r => r.UserGameEntryId == e.Id));
    }

    /// <summary>
    /// The profiles worth a place in a search index: public, named, and with something on them — an
    /// entry from <see cref="ShownEntries"/>, or a favourite, which needs no entry (ADR 0029). A
    /// wishlist alone is not enough: its size is all a profile shows of it.
    /// </summary>
    public static IQueryable<ApplicationUser> ListedProfiles(ApplicationDbContext db)
    {
        var shown = ShownEntries(db);

        return db.Users
            .Where(u => u.ProfileVisibility == ProfileVisibility.Public && u.UserName != null)
            .Where(u => shown.Any(e => e.UserId == u.Id)
                || db.UserFavourites.Any(f => f.UserId == u.Id));
    }
}
