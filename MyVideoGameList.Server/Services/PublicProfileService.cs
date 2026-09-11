using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The public half of a profile: what a user has published, read by their username.
/// </summary>
/// <remarks>
/// <para>
/// The figures are not recomputed here. <see cref="IStatsService"/> already derives all of them
/// from the user's own rows, and a second aggregation over the same tables is a second answer
/// waiting to disagree with the first — a public profile claiming a different completion rate from
/// the one its owner is looking at would be worse than having no public profile. What this class
/// adds is the visibility gate and the choice of which figures cross it.
/// </para>
/// <para>
/// <b>Two gates, and the narrower always wins.</b> The account's
/// <see cref="ApplicationUser.ProfileVisibility"/> decides whether there is a page at all;
/// <see cref="Review.Visibility"/> decides which reviews appear on it. A public review by somebody
/// whose profile is private is visible to nobody, which is the only reading of the two settings
/// that does not surprise the person who set them.
/// </para>
/// </remarks>
public class PublicProfileService(
    ApplicationDbContext db,
    ILookupNormalizer normalizer,
    IStatsService stats,
    IIgdbService igdbService) : IPublicProfileService
{
    /// <summary>
    /// How many reviews one page carries. Long-form text, so the page is short.
    /// </summary>
    internal const int ReviewsPerPage = 20;

    public async Task<PublicProfileDto?> GetProfileAsync(
        string userName, CancellationToken cancellationToken = default)
    {
        var user = await FindPublicAsync(userName, cancellationToken);
        if (user is null) return null;

        var figures = await stats.GetStatsAsync(user.Id, cancellationToken);

        // The one figure the stats service has no reason to know about: a review is nothing to do
        // with tracking, and the private profile counts none of them.
        var reviews = await db.Reviews
            .AsNoTracking()
            .CountAsync(
                r => r.UserId == user.Id && r.Visibility == ReviewVisibility.Public,
                cancellationToken);

        // Copied across field by field on purpose — see PublicProfileDto for why this is not a
        // cast, a mapper or a subset attribute.
        return new PublicProfileDto(
            UserName: user.UserName!,
            Activity: new PublicActivityDto(
                figures.Activity.LogStartedAt,
                figures.Activity.Months,
                figures.Activity.CurrentStreakMonths,
                figures.Activity.LongestStreakMonths),
            Library: figures.Library,
            Scores: figures.Scores,
            Playtime: new PublicPlaytimeDto(
                figures.Playtime.Playthroughs,
                figures.Playtime.TotalMinutes,
                figures.Playtime.WithHours),
            Reviews: reviews);
    }

    public async Task<PublicReviewsDto?> GetReviewsAsync(
        string userName, int page, CancellationToken cancellationToken = default)
    {
        var user = await FindPublicAsync(userName, cancellationToken);
        if (user is null) return null;

        // Scoped on the review's own UserId and on its own visibility, in the predicate rather than
        // filtered afterwards: this is the authorization boundary and it belongs where it can be
        // read.
        var published = db.Reviews
            .AsNoTracking()
            .Where(r => r.UserId == user.Id && r.Visibility == ReviewVisibility.Public);

        var total = await published.CountAsync(cancellationToken);

        // The page number arrives validated to be positive, not to be small: int.MaxValue is a
        // legal page, and multiplying it by the page size overflows into a negative offset that
        // PostgreSQL refuses. Computed wide, and a page past the end is answered here — without
        // the query, and without the IGDB call — as the empty page it is.
        var wanted = Math.Max(page, 1);
        var offset = (long)(wanted - 1) * ReviewsPerPage;

        if (offset >= total)
            return new PublicReviewsDto(user.UserName!, [], total, wanted, ReviewsPerPage);

        var rows = await published
            // Most recently written or rewritten first, with the key as a tie-break so a page
            // boundary does not depend on the order the database happens to return rows in.
            .OrderByDescending(r => r.UpdatedAt)
            .ThenByDescending(r => r.Id)
            .Skip((int)offset)
            .Take(ReviewsPerPage)
            .Select(r => new
            {
                r.Entry.GameId,
                r.Body,
                r.HasSpoilers,
                // The author's score, which lives on the entry rather than on the review.
                r.Entry.Score,
                r.CreatedAt,
                r.UpdatedAt
            })
            .ToListAsync(cancellationToken);

        var games = rows.Count == 0
            ? []
            : (await igdbService.GetGamesByIdsAsync(
                rows.Select(r => r.GameId).Distinct().ToList(), cancellationToken))
                .ToDictionary(g => g.Id);

        // A review of a game IGDB no longer returns is dropped rather than rendered against a
        // blank card, exactly as an entry is in ListService. `Total` still counts it, because the
        // count is about what the user wrote and not about what a third party can still describe.
        var reviews = rows
            .Select(r => games.TryGetValue(r.GameId, out var game)
                ? new PublicReviewDto(game, r.Body, r.HasSpoilers, r.Score, r.CreatedAt, r.UpdatedAt)
                : null)
            .OfType<PublicReviewDto>()
            .ToList();

        return new PublicReviewsDto(user.UserName!, reviews, total, wanted, ReviewsPerPage);
    }

    /// <summary>
    /// The account behind a username, if it has a public profile.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Matched on <c>NormalizedUserName</c> through Identity's own
    /// <see cref="ILookupNormalizer"/> rather than with a hand-written <c>ToUpperInvariant</c>.
    /// That column is what the unique index covers, so this is the lookup that uses it — and going
    /// through the injected normalizer means a change to how Identity normalizes cannot leave this
    /// query matching a different set of rows than the index enforces uniqueness over.
    /// </para>
    /// <para>
    /// The visibility test is part of the same predicate rather than a check on the result.
    /// "Private" and "no such user" are then indistinguishable to the caller by construction, which
    /// is the point: a 403 for one and a 404 for the other would turn this endpoint into a way of
    /// asking whether a given name has an account, which is precisely what somebody with a private
    /// profile has declined to say.
    /// </para>
    /// </remarks>
    private async Task<ApplicationUser?> FindPublicAsync(
        string userName, CancellationToken cancellationToken)
    {
        var normalized = normalizer.NormalizeName(userName);
        if (string.IsNullOrEmpty(normalized)) return null;

        return await db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(
                u => u.NormalizedUserName == normalized
                    && u.ProfileVisibility == ProfileVisibility.Public,
                cancellationToken);
    }
}
