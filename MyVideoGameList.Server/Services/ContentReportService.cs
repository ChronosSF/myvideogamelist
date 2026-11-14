using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Files a reader's report of a published review or a public profile.
/// </summary>
/// <remarks>
/// <para>
/// <b>Only what a reader can see can be reported</b>, decided by the same predicates the public reads use:
/// a public profile, and on it a review marked public and not hidden. Anything else is the same "no",
/// so the endpoint cannot be used to ask whether a name has an account (ADR 0027 §7).
/// </para>
/// <para>
/// <b>One report per reader per thing.</b> Reporting it again replaces the reason and the note, and keeps
/// the first moment, which is the queue's order. The two unique indexes hold that against two requests at
/// once, and the loser of that race is answered as the winner was rather than with a 500. See
/// <c>docs/decisions/0076-*</c>.
/// </para>
/// </remarks>
public class ContentReportService(
    ApplicationDbContext db,
    ILookupNormalizer normalizer,
    TimeProvider clock) : IContentReportService
{
    public async Task<bool> ReportAsync(
        string reporterId, ReportInputDto input, CancellationToken cancellationToken = default)
    {
        var normalized = normalizer.NormalizeName(input.UserName.Trim());
        if (string.IsNullOrEmpty(normalized)) return false;

        // The profile gate in the predicate, as PublicProfileService draws it.
        var subjectId = await db.Users
            .AsNoTracking()
            .Where(u => u.NormalizedUserName == normalized && u.ProfileVisibility == ProfileVisibility.Public)
            .Select(u => u.Id)
            .FirstOrDefaultAsync(cancellationToken);

        if (subjectId is null) return false;

        int? reviewId = null;
        if (input.GameId is int gameId)
        {
            // All three gates, as the game page's member reviews draw them: a review a reader could not
            // have read is not one they can report.
            reviewId = await db.Reviews
                .AsNoTracking()
                .Where(r => r.UserId == subjectId
                    && r.Entry.GameId == gameId
                    && r.Visibility == ReviewVisibility.Public
                    && r.HiddenAt == null)
                .Select(r => (int?)r.Id)
                .FirstOrDefaultAsync(cancellationToken);

            if (reviewId is null) return false;
        }

        var reason = input.Reason;
        var note = string.IsNullOrWhiteSpace(input.Note) ? null : input.Note.Trim();

        var existing = await Mine(reporterId, reviewId, subjectId).FirstOrDefaultAsync(cancellationToken);
        if (existing is not null)
        {
            existing.Reason = reason;
            existing.Note = note;
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }

        db.ContentReports.Add(new ContentReport
        {
            UserId = reporterId,
            ReviewId = reviewId,
            // A review's report names the review alone: its author is the review's, and a second pointer
            // would be a second place to keep in step with it.
            ProfileUserId = reviewId is null ? subjectId : null,
            Reason = reason,
            Note = note,
            CreatedAt = clock.GetUtcNow(),
        });

        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Two of this reader's requests reporting the same thing at once, and the other one's row
            // got in first: the reader has reported it, which is all either request asked. Confirmed by
            // reading again rather than by matching PostgreSQL's error code, as WishlistService does, so
            // that anything else that failed the save still fails.
            db.ChangeTracker.Clear();
            if (await Mine(reporterId, reviewId, subjectId).AnyAsync(cancellationToken)) return true;
            throw;
        }

        return true;
    }

    /// <summary>This reader's report of this review, or of this profile when there is no review.</summary>
    private IQueryable<ContentReport> Mine(string reporterId, int? reviewId, string subjectId) =>
        reviewId is int id
            ? db.ContentReports.Where(r => r.UserId == reporterId && r.ReviewId == id)
            : db.ContentReports.Where(r => r.UserId == reporterId && r.ProfileUserId == subjectId);
}
