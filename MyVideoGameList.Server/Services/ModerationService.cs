using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// What readers reported, and what an admin may do about it: hide a review, clear a profile's display name,
/// picture or bio, or dismiss the reports.
/// </summary>
/// <remarks>
/// <para>
/// <b>An admin withdraws publication and never writes a member's words.</b> Every write here is one the
/// member could have made, or undone, themselves: a review's <see cref="Review.HiddenAt"/>, set or cleared,
/// and three of the account's columns set to null, as the owner's own blank sets them. That is the whole of
/// what ADR 0076 adds to 0042's "reference data, never a member's".
/// </para>
/// <para>
/// <b>It selects only what a reader reported, and what was hidden.</b> No list of members, no search: a
/// member's words reach the admin page because somebody put them in front of it (0051 §2, as amended). The
/// reporter is never in what it returns.
/// </para>
/// <para>
/// <b>Acting answers every report of the thing, and answering a report deletes it</b>, in the same save as
/// the act: once answered nothing reads it. A hidden review and a cleared field are withdrawals, so each
/// takes the profile off the edge after it commits, through <see cref="ProfileWithdrawals"/> (0058 §1, as
/// amended).
/// </para>
/// </remarks>
public class ModerationService(
    ApplicationDbContext db,
    UserManager<ApplicationUser> users,
    IGameCacheService gameCache,
    ProfileWithdrawals withdrawals,
    TimeProvider clock) : IModerationService
{
    /// <summary>
    /// How many of each list one read returns. A page one admin works through, and a bound on the read
    /// whatever a script has reported.
    /// </summary>
    internal const int PageSize = 50;

    public async Task<ModerationQueueDto> GetQueueAsync(CancellationToken cancellationToken = default)
    {
        var (reviews, reviewsTotal) = await ReportedReviewsAsync(cancellationToken);
        var (profiles, profilesTotal) = await ReportedProfilesAsync(cancellationToken);
        var (hidden, hiddenTotal) = await HiddenReviewsAsync(cancellationToken);

        var titles = await TitlesAsync(
            reviews.Select(r => r.GameId).Concat(hidden.Select(h => h.GameId)), cancellationToken);

        return new ModerationQueueDto(
            reviews.Select(r => r with { GameTitle = titles.GetValueOrDefault(r.GameId) }).ToList(),
            reviewsTotal,
            profiles,
            profilesTotal,
            hidden.Select(h => h with { GameTitle = titles.GetValueOrDefault(h.GameId) }).ToList(),
            hiddenTotal);
    }

    /// <summary>The reviews with open reports, the one reported longest ago first.</summary>
    private async Task<(List<ReportedReviewDto>, int)> ReportedReviewsAsync(CancellationToken cancellationToken)
    {
        var reported = db.ContentReports.AsNoTracking().Where(r => r.ReviewId != null);
        var total = await reported.Select(r => r.ReviewId).Distinct().CountAsync(cancellationToken);
        if (total == 0) return ([], 0);

        var ids = await reported
            .GroupBy(r => r.ReviewId)
            .Select(g => new { ReviewId = g.Key, First = g.Min(r => r.CreatedAt) })
            .OrderBy(g => g.First)
            .ThenBy(g => g.ReviewId)
            .Take(PageSize)
            .Select(g => g.ReviewId)
            .ToListAsync(cancellationToken);

        var reports = await ReportsOf(reported.Where(r => ids.Contains(r.ReviewId)), r => r.ReviewId!.Value, cancellationToken);

        var rows = await db.Reviews
            .AsNoTracking()
            .Where(r => ids.Contains(r.Id))
            .Select(r => new
            {
                r.Id,
                r.User.UserName,
                r.User.DisplayName,
                r.Entry.GameId,
                r.Body,
                r.HasSpoilers,
                // What a reader would see now, by the three gates every public read draws.
                Published = r.Visibility == ReviewVisibility.Public
                    && r.User.ProfileVisibility == ProfileVisibility.Public
                    && r.HiddenAt == null,
            })
            .ToDictionaryAsync(r => r.Id, cancellationToken);

        // In the queue's order, which the dictionary does not keep. A review deleted since the reports were
        // read has taken them with it, and is left out.
        var items = ids
            .Select(id => id is int key && rows.TryGetValue(key, out var r)
                ? new ReportedReviewDto(
                    r.Id, r.UserName!, r.DisplayName, r.GameId, null, r.Body, r.HasSpoilers, r.Published,
                    reports.GetValueOrDefault(r.Id) ?? [])
                : null)
            .OfType<ReportedReviewDto>()
            .ToList();

        return (items, total);
    }

    /// <summary>The profiles with open reports, the one reported longest ago first.</summary>
    private async Task<(List<ReportedProfileDto>, int)> ReportedProfilesAsync(CancellationToken cancellationToken)
    {
        var reported = db.ContentReports.AsNoTracking().Where(r => r.ProfileUserId != null);
        var total = await reported.Select(r => r.ProfileUserId).Distinct().CountAsync(cancellationToken);
        if (total == 0) return ([], 0);

        var ids = await reported
            .GroupBy(r => r.ProfileUserId)
            .Select(g => new { AccountId = g.Key, First = g.Min(r => r.CreatedAt) })
            .OrderBy(g => g.First)
            .ThenBy(g => g.AccountId)
            .Take(PageSize)
            .Select(g => g.AccountId)
            .ToListAsync(cancellationToken);

        var reports = await ReportsOf(reported.Where(r => ids.Contains(r.ProfileUserId)), r => r.ProfileUserId!, cancellationToken);

        var accounts = await db.Users
            .AsNoTracking()
            .Where(u => ids.Contains(u.Id))
            .Select(u => new
            {
                u.Id,
                u.UserName,
                u.DisplayName,
                u.AvatarUrl,
                u.Bio,
                Published = u.ProfileVisibility == ProfileVisibility.Public,
            })
            .ToDictionaryAsync(u => u.Id, cancellationToken);

        var items = ids
            .Select(id => id is not null && accounts.TryGetValue(id, out var u)
                ? new ReportedProfileDto(
                    u.Id, u.UserName!, u.DisplayName, u.AvatarUrl, u.Bio, u.Published,
                    reports.GetValueOrDefault(u.Id) ?? [])
                : null)
            .OfType<ReportedProfileDto>()
            .ToList();

        return (items, total);
    }

    /// <summary>Every report among these, by what it reports, each thing's oldest first.</summary>
    private static async Task<Dictionary<TKey, List<ReportDto>>> ReportsOf<TKey>(
        IQueryable<ContentReport> reports, Func<ContentReport, TKey> subject, CancellationToken cancellationToken)
        where TKey : notnull =>
        (await reports
            .OrderBy(r => r.CreatedAt)
            .ThenBy(r => r.Id)
            .ToListAsync(cancellationToken))
        .GroupBy(subject)
        .ToDictionary(g => g.Key, g => g.Select(r => new ReportDto(r.Reason, r.Note, r.CreatedAt)).ToList());

    /// <summary>The hidden reviews, the one hidden last first.</summary>
    private async Task<(List<HiddenReviewDto>, int)> HiddenReviewsAsync(CancellationToken cancellationToken)
    {
        var hidden = db.Reviews.AsNoTracking().Where(r => r.HiddenAt != null);
        var total = await hidden.CountAsync(cancellationToken);
        if (total == 0) return ([], 0);

        var items = await hidden
            .OrderByDescending(r => r.HiddenAt)
            .ThenByDescending(r => r.Id)
            .Take(PageSize)
            .Select(r => new HiddenReviewDto(
                r.Id, r.User.UserName!, r.Entry.GameId, null, r.Body, r.HasSpoilers, r.HiddenAt!.Value))
            .ToListAsync(cancellationToken);

        return (items, total);
    }

    /// <summary>
    /// What the game cache calls each game, for the admin to recognise it by. Games somebody already wrote
    /// about, so through the cache rather than IGDB (ADR 0035), and a game it has nothing for is shown by
    /// its id rather than holding up the queue.
    /// </summary>
    private async Task<Dictionary<int, string>> TitlesAsync(IEnumerable<int> gameIds, CancellationToken cancellationToken)
    {
        var ids = gameIds.Distinct().ToList();
        if (ids.Count == 0) return [];

        return (await gameCache.GetGamesAsync(ids, cancellationToken)).ToDictionary(g => g.Id, g => g.Title);
    }

    public async Task<bool> HideReviewAsync(int reviewId, CancellationToken cancellationToken = default)
    {
        var review = await db.Reviews.FirstOrDefaultAsync(r => r.Id == reviewId, cancellationToken);
        if (review is null) return false;

        var hiding = review.HiddenAt is null;
        if (hiding) review.HiddenAt = clock.GetUtcNow();

        // Answered by the act, in the same save.
        db.ContentReports.RemoveRange(
            await db.ContentReports.Where(r => r.ReviewId == reviewId).ToListAsync(cancellationToken));

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A row this read is gone: its author deleted the review, which took its reports with it, or a
            // second tab dismissed one of them. The admin is told the review is not there and reads the
            // queue again. Only the columns this changed are written, so an edit by its author in between
            // is not a conflict, and keeps its words with the hide.
            return false;
        }

        // Decided by nothing else it read, as the deletes are (0058 §1): its author can publish it between
        // the read above and the save, and a review has no stamp to refuse the save on. A hide is rare, so
        // the cost is a path where it was private. Asked of the profile after the commit, without the
        // request's token.
        if (hiding) await withdrawals.ReviewWithdrawnAsync(review.UserId, ReviewWithdrawal.Hidden);

        return true;
    }

    public async Task<bool> ShowReviewAsync(int reviewId, CancellationToken cancellationToken = default)
    {
        var review = await db.Reviews.FirstOrDefaultAsync(r => r.Id == reviewId && r.HiddenAt != null, cancellationToken);
        if (review is null) return false;

        review.HiddenAt = null;

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }

        // Shown again publishes, under whatever gates its author has set, and waits out the edge's window
        // like any new review: nothing was taken back, so nothing is sent.
        return true;
    }

    public async Task DismissReviewReportsAsync(int reviewId, CancellationToken cancellationToken = default) =>
        await DeleteAsync(db.ContentReports.Where(r => r.ReviewId == reviewId), cancellationToken);

    public async Task<ProfileClear> ClearProfileAsync(
        string accountId, ClearProfileDto fields, CancellationToken cancellationToken = default)
    {
        var account = await users.FindByIdAsync(accountId);
        if (account is null) return ProfileClear.NotFound;

        // Decided from the state before the save, as the owner's own save decides it (ADR 0056 §8): only a
        // value the page has shown can be taken back.
        var takesBack = (fields.DisplayName && account.DisplayName is not null)
            || (fields.AvatarUrl && account.AvatarUrl is not null)
            || (fields.Bio && account.Bio is not null);

        if (fields.DisplayName) account.DisplayName = null;
        if (fields.AvatarUrl) account.AvatarUrl = null;
        if (fields.Bio) account.Bio = null;

        // Tracked before Identity saves, on the context its store shares, so that the clear and the
        // answer to the reports commit together or not at all.
        db.ContentReports.RemoveRange(
            await db.ContentReports.Where(r => r.ProfileUserId == accountId).ToListAsync(cancellationToken));

        // Through UserManager, as the owner's save goes, so the account's concurrency stamp refuses a clear
        // over a row its owner saved since it was read (0058 §3) rather than writing their old values back
        // over their new ones. The stamp moves; the security stamp does not, so nobody is signed out.
        var saved = await users.UpdateAsync(account);
        if (!saved.Succeeded)
        {
            db.ChangeTracker.Clear();
            return saved.Errors.Any(e => e.Code == nameof(IdentityErrorDescriber.ConcurrencyFailure))
                ? ProfileClear.Conflict
                : throw new InvalidOperationException(
                    $"Clearing account {accountId}'s profile failed: {string.Join(" ", saved.Errors.Select(e => e.Code))}");
        }

        if (takesBack && account.ProfileVisibility == ProfileVisibility.Public && account.UserName is { } name)
            withdrawals.ProfileDetailsChanged(name);

        return ProfileClear.Cleared;
    }

    public async Task DismissProfileReportsAsync(string accountId, CancellationToken cancellationToken = default) =>
        await DeleteAsync(db.ContentReports.Where(r => r.ProfileUserId == accountId), cancellationToken);

    /// <summary>
    /// Deletes the reports a dismissal answers. Loaded and removed rather than deleted by one statement,
    /// because there are a handful and the tests run on a provider that has no set-based delete.
    /// </summary>
    private async Task DeleteAsync(IQueryable<ContentReport> reports, CancellationToken cancellationToken)
    {
        db.ContentReports.RemoveRange(await reports.ToListAsync(cancellationToken));

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another request answered some of them first, an act or a dismissal in a second tab, or their
            // subject went and took them. Either way they are answered, which is what this was for.
            db.ChangeTracker.Clear();
        }
    }
}
