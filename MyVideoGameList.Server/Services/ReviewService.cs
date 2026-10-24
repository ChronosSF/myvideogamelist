using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Edge;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and writes <see cref="Review"/> rows — one per user per game.
/// </summary>
/// <remarks>
/// <para>
/// Separate from <see cref="PlaythroughService"/> despite sitting on the same entry, because the
/// two are different acts with different cardinality: a game has many playthroughs and at most one
/// review, and nothing about a review feeds an aggregate.
/// </para>
/// <para>
/// <b>Writes no <see cref="UserGameEvent"/> and touches no
/// <see cref="UserGameEntry.StatusId"/>.</b> Writing about a game is not a status transition, and
/// the log stays typed and narrow (ADR 0018). No IGDB call either, for the reason every write path
/// here avoids one.
/// </para>
/// <para>
/// <b>Changing a public review is a withdrawal, and so is deleting any review</b>, because the
/// author's public profile renders the text and the edge keeps a copy of that page. Each one tells
/// <see cref="ProfileWithdrawals"/> after it commits. A delete does so whatever it read of the
/// review's visibility, which the author's own request can change before the delete lands. A
/// review written for the first time, a private one rewritten, and one saved again unchanged
/// withdraw nothing and tell it nothing (ADR 0058).
/// </para>
/// </remarks>
public class ReviewService(
    ApplicationDbContext db,
    TimeProvider clock,
    ProfileWithdrawals withdrawals) : IReviewService
{
    public async Task<ReviewDto?> GetAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var review = await db.Reviews
            .AsNoTracking()
            // Scoped on the review's own UserId. The predicate is the authorization boundary and
            // belongs where it can be read, not inferred from the entry it joins.
            .Where(r => r.UserId == userId && r.Entry.GameId == gameId)
            .FirstOrDefaultAsync(cancellationToken);

        return review is null ? null : ToDto(review);
    }

    public async Task<ReviewDto> UpsertAsync(
        string userId, int gameId, ReviewInputDto input, CancellationToken cancellationToken = default)
    {
        // Writing about a game the user has never listed is legitimate and creates the entry with
        // no status, exactly as scoring one does (ADR 0019).
        var entry = await EntryStore.FindOrCreateAsync(db, clock, userId, gameId, cancellationToken);

        var playthroughId = await ResolvePlaythroughIdAsync(
            userId, gameId, input.PlaythroughId, cancellationToken);

        var existing = await db.Reviews
            .FirstOrDefaultAsync(r => r.UserId == userId && r.Entry.GameId == gameId, cancellationToken);

        var now = clock.GetUtcNow();

        if (existing is not null)
        {
            // Read before the fields change: what the edge can hold is what was public until now.
            // A save of this review by another of its author's requests, landing between this read
            // and the write below, is not seen; ADR 0058 §3 says why that race is left open.
            var published = existing.Visibility == ReviewVisibility.Public
                ? (existing.Body, existing.HasSpoilers)
                : ((string, bool)?)null;

            existing.Body = input.Body.Trim();
            existing.HasSpoilers = input.HasSpoilers;
            existing.Visibility = input.Visibility;
            existing.PlaythroughId = playthroughId;
            existing.UpdatedAt = now;

            await db.SaveChangesAsync(cancellationToken);

            // Withdrawn when it was public and now says something else or nothing: different words,
            // a spoiler warning added or taken off, or no longer public. Saved again unchanged it
            // withdraws nothing — its move up the newest-first list is content, like a new score —
            // and sends nothing, which also keeps a save button pressed in a loop off the bill.
            if (published is { } before)
            {
                if (existing.Visibility != ReviewVisibility.Public)
                    await withdrawals.ReviewWithdrawnAsync(userId, ReviewWithdrawal.MadePrivate);
                else if (before != (existing.Body, existing.HasSpoilers))
                    await withdrawals.ReviewWithdrawnAsync(userId, ReviewWithdrawal.Edited);
            }

            return ToDto(existing);
        }

        var review = new Review
        {
            UserId = userId,
            // Through the navigation rather than by copying the key: a newly created entry has no
            // Id until SaveChanges, and EF fills both halves of the composite foreign key in.
            Entry = entry,
            Body = input.Body.Trim(),
            HasSpoilers = input.HasSpoilers,
            Visibility = input.Visibility,
            PlaythroughId = playthroughId,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.Reviews.Add(review);
        await db.SaveChangesAsync(cancellationToken);
        return ToDto(review);
    }

    public async Task<bool> DeleteAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var review = await db.Reviews
            .FirstOrDefaultAsync(r => r.UserId == userId && r.Entry.GameId == gameId, cancellationToken);

        if (review is null) return false;

        // The entry, the score and the playthroughs stay: deleting what you wrote about a game is
        // not deleting your record of it.
        db.Reviews.Remove(review);
        await db.SaveChangesAsync(cancellationToken);

        // Whatever its visibility was when it was read above. Another of the author's requests can
        // publish it between that read and this delete, and a render in between can put it at the
        // edge, so private as read is not private as deleted. The cost is a path when a private
        // review goes (ADR 0058 §1).
        await withdrawals.ReviewWithdrawnAsync(userId, ReviewWithdrawal.Deleted);
        return true;
    }

    /// <summary>
    /// Checks that a supplied playthrough id is one of this user's, for this game.
    /// </summary>
    /// <remarks>
    /// A foreign key alone would accept any real playthrough, including somebody else's — the
    /// pointer is not covered by the composite key that guards the entry. So it is verified with
    /// the same <c>UserId</c> predicate every other read here uses, and a mismatch is an
    /// <see cref="ArgumentException"/> the controller turns into a 400 rather than a stored lie.
    /// </remarks>
    private async Task<int?> ResolvePlaythroughIdAsync(
        string userId, int gameId, int? playthroughId, CancellationToken cancellationToken)
    {
        if (playthroughId is not int id) return null;

        var owned = await db.UserGamePlaythroughs
            .AsNoTracking()
            .AnyAsync(
                p => p.Id == id && p.UserId == userId && p.Entry.GameId == gameId,
                cancellationToken);

        return owned
            ? id
            : throw new ArgumentException(
                $"Playthrough {id} is not one of this user's playthroughs of game {gameId}.",
                nameof(playthroughId));
    }

    private static ReviewDto ToDto(Review review) =>
        new(
            review.Id,
            review.Body,
            review.HasSpoilers,
            review.Visibility,
            review.PlaythroughId,
            review.CreatedAt,
            review.UpdatedAt);
}
