using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The community's reading of one game: every member's score, and the reviews members have
/// published.
/// </summary>
/// <remarks>
/// <para>
/// Everything built before this aggregates one person's rows across every game. This is the other
/// axis — everybody's rows for one game — which is a different query shape rather than a different
/// page, and the one the <c>(GameId, Score)</c> index on the entry exists for. See
/// <c>docs/decisions/0028-*</c>.
/// </para>
/// <para>
/// <b>The two reads cross different gates, on purpose.</b> The scores are an aggregate that names
/// nobody, so every score counts whatever the profile visibility of the account behind it, on the
/// same basis as the community completion times. The reviews name their authors, so only a review
/// marked public by somebody whose profile is public is listed — the narrower setting wins, exactly
/// as it does on the profile (ADR 0027).
/// </para>
/// <para>
/// <b>No cache</b>, unlike the community times, which are cached for five minutes and evicted by the
/// playthrough writes beside them. A review withdrawn — made private, deleted, or hidden by its
/// author's profile going private — has to stop being listed when it is withdrawn, and an eviction
/// is per instance, so a cache would keep serving it from every other instance until its TTL ran
/// out. The scores follow for the reason ADR 0023 gives: the member who has just scored the game is
/// the likeliest reader, and a figure that ignores what they just did reads as a failed write.
/// Both reads are bounded by the index.
/// </para>
/// <para>
/// No IGDB call on either path. The page already has the game; what it needs from here is our own
/// rows, and an outage upstream should not cost it the members' view.
/// </para>
/// </remarks>
public class GameCommunityService(
    ApplicationDbContext db,
    IDataProtectionProvider dataProtection) : IGameCommunityService
{
    /// <summary>
    /// How many reviews one page carries. Fewer than a profile's twenty, because on the game page
    /// they are one section among many rather than the page itself.
    /// </summary>
    internal const int ReviewsPerPage = 10;

    /// <summary>Encrypts the cursors, which carry a review id the client must not see.</summary>
    private readonly IDataProtector cursors = dataProtection.CreateProtector(ReviewCursor.Purpose);

    public async Task<CommunityScoresDto> GetScoresAsync(
        int gameId, CancellationToken cancellationToken = default)
    {
        // The scores come back as one small column and are counted in C#, following ADR 0023: the
        // tests run on the in-memory provider, so arithmetic done by GROUP BY would be verified
        // against something PostgreSQL never runs. Both columns this reads are in the
        // (GameId, Score) index, so PostgreSQL can answer it with an index-only scan; ADR 0028
        // records the size at which reading every score stops being cheap enough.
        var scores = await db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.GameId == gameId && e.Score != null)
            .Select(e => e.Score)
            .ToListAsync(cancellationToken);

        var (scored, mean, distribution) = ScoreSummary.Of(scores);
        return new CommunityScoresDto(scored, mean, distribution);
    }

    public async Task<GameReviewsDto> GetReviewsAsync(
        int gameId, string? after, CancellationToken cancellationToken = default)
    {
        // A cursor that does not decrypt must not quietly mean "from the start", which would show a
        // reader the first page again as though it were the next. The controller turns this into a
        // 400 beside the parameter.
        var afterCreatedAt = default(DateTimeOffset);
        var afterId = 0;
        if (after is not null && !ReviewCursor.TryParse(cursors, after, out afterCreatedAt, out afterId))
            throw new ArgumentException("Not a cursor this list issued.", nameof(after));

        // Both gates in the predicate rather than filtered afterwards: this is the authorization
        // boundary, and it belongs where it can be read. A public review on a private profile is
        // published nowhere, which is the only reading of the two settings that does not surprise
        // whoever set them.
        var published = db.Reviews
            .AsNoTracking()
            .Where(r => r.Entry.GameId == gameId
                && r.Visibility == ReviewVisibility.Public
                && r.User.ProfileVisibility == ProfileVisibility.Public);

        var total = await published.CountAsync(cancellationToken);

        // Everything after the review the previous page ended on, in the order below. A position
        // rather than an offset, because rows move while somebody reads and an offset then lands one
        // too far on — see ReviewCursor.
        var remaining = after is null
            ? published
            : published.Where(r => r.CreatedAt < afterCreatedAt
                || (r.CreatedAt == afterCreatedAt && r.Id < afterId));

        var rows = await remaining
            // Most recently written first, on two keys that never change, which is what keeps a
            // cursor's place in the order still: CreatedAt, which a rewrite does not touch, then the
            // id for two reviews written in the same instant. Not the author's name — a rename can
            // move a review across the cursor between two requests.
            .OrderByDescending(r => r.CreatedAt)
            .ThenByDescending(r => r.Id)
            // One more than a page, to learn whether there is another without counting the rest.
            .Take(ReviewsPerPage + 1)
            .Select(r => new
            {
                // Read for the cursor only; it never reaches the response unencrypted.
                r.Id,
                r.User.UserName,
                r.Body,
                r.HasSpoilers,
                // The author's score, which lives on the entry rather than on the review.
                r.Entry.Score,
                r.CreatedAt,
                r.UpdatedAt
            })
            .ToListAsync(cancellationToken);

        var page = rows.Take(ReviewsPerPage).ToList();
        var next = rows.Count > ReviewsPerPage
            ? ReviewCursor.Format(cursors, page[^1].CreatedAt, page[^1].Id)
            : null;

        // Copied across field by field, for the reason PublicProfileDto gives: nothing reaches a
        // public document without somebody writing it in.
        var reviews = page
            .Select(r => new GameReviewDto(
                r.UserName!, r.Body, r.HasSpoilers, r.Score, r.CreatedAt, r.UpdatedAt))
            .ToList();

        return new GameReviewsDto(reviews, total, next);
    }
}
