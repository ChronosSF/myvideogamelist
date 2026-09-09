using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Reads and writes <see cref="UserGamePlaythrough"/> rows, and derives the community medians over
/// everybody's.
/// </summary>
/// <remarks>
/// <para>
/// A service of its own rather than more methods on <see cref="ListService"/>, on the same
/// argument <see cref="WishlistService"/> was split out with: a playthrough shares nothing with
/// list membership but the entry it hangs off. It records no status, appends no event, and its
/// most interesting read is about every user rather than one.
/// </para>
/// <para>
/// <b>Nothing here writes a <see cref="UserGameEvent"/> or touches
/// <see cref="UserGameEntry.StatusId"/>.</b> Playing a game and saying so are different acts, and
/// they genuinely diverge: replaying something already marked Finished adds a playthrough with no
/// transition at all. Status changes go through <see cref="ListService"/> and nowhere else
/// (ADR 0018).
/// </para>
/// <para>
/// No IGDB call on any path. A write must not depend on a third party being reachable, and the
/// community aggregate is about our own rows — the platform id is stored bare and resolved to a
/// name on the client.
/// </para>
/// </remarks>
public class PlaythroughService(
    ApplicationDbContext db,
    IMemoryCache cache,
    TimeProvider clock) : IPlaythroughService
{
    /// <summary>
    /// How long a game's community medians are served from memory.
    /// </summary>
    /// <remarks>
    /// Short, because the person most likely to look at this row is the one who has just logged a
    /// playthrough and wants to see it counted. The write path evicts the key so that reader gets
    /// their own figure immediately — but eviction is <b>per instance</b>, so behind more than one
    /// task another instance keeps serving the old figure until this expires. Five minutes is what
    /// bounds that staleness, and it stops being an approximation once the cache moves to Redis
    /// (ADR 0012).
    /// </remarks>
    private static readonly TimeSpan CommunityTimesTtl = TimeSpan.FromMinutes(5);

    /// <summary>One playthrough, flattened to what a DTO needs. No game metadata is fetched.</summary>
    private record PlaythroughRow(
        int Id,
        short? TypeId,
        int? PlatformId,
        int? MinutesPlayed,
        DateOnly? StartedOn,
        DateOnly? FinishedOn,
        string? Notes,
        DateTimeOffset CreatedAt,
        DateTimeOffset UpdatedAt);

    public async Task<IReadOnlyList<PlaythroughDto>> GetForGameAsync(
        string userId, int gameId, CancellationToken cancellationToken = default)
    {
        var typeKeys = await TypeKeysByIdAsync(cancellationToken);

        var rows = await db.UserGamePlaythroughs
            .AsNoTracking()
            // Scoped on the playthrough's own UserId, not on the entry's. Both are the same column
            // by construction, but the predicate is the authorization boundary and it belongs
            // where it can be read.
            .Where(p => p.UserId == userId && p.Entry.GameId == gameId)
            .Select(p => new PlaythroughRow(
                p.Id, p.TypeId, p.PlatformId, p.MinutesPlayed,
                p.StartedOn, p.FinishedOn, p.Notes, p.CreatedAt, p.UpdatedAt))
            .ToListAsync(cancellationToken);

        // Ordered in memory rather than in SQL, because the two disagree about nulls: PostgreSQL
        // sorts them last on an ascending order and the in-memory provider the tests run on sorts
        // them first. A handful of rows per game makes that a free way to have the order the tests
        // assert be the order that ships. Undated playthroughs come first and fall back to when
        // they were logged.
        return rows
            .OrderBy(p => p.StartedOn)
            .ThenBy(p => p.CreatedAt)
            .ThenBy(p => p.Id)
            .Select(p => ToDto(p, typeKeys))
            .ToList();
    }

    public async Task<PlaythroughDto> AddAsync(
        string userId, int gameId, PlaythroughInputDto input, CancellationToken cancellationToken = default)
    {
        var typeKeys = await TypeKeysByIdAsync(cancellationToken);
        var typeId = ResolveTypeId(typeKeys, input.Type);

        // Logging a playthrough of a game the user has never listed is legitimate and creates the
        // entry with no status, exactly as scoring one does (ADR 0019).
        var entry = await EntryStore.FindOrCreateAsync(db, clock, userId, gameId, cancellationToken);

        var now = clock.GetUtcNow();
        var playthrough = new UserGamePlaythrough
        {
            UserId = userId,
            // Through the navigation rather than by copying the key: a newly created entry has no
            // Id until SaveChanges, and EF fills both halves of the composite foreign key in.
            Entry = entry,
            TypeId = typeId,
            PlatformId = input.PlatformId,
            MinutesPlayed = input.MinutesPlayed,
            StartedOn = input.StartedOn,
            FinishedOn = input.FinishedOn,
            Notes = Trimmed(input.Notes),
            CreatedAt = now,
            UpdatedAt = now
        };

        db.UserGamePlaythroughs.Add(playthrough);
        await db.SaveChangesAsync(cancellationToken);

        EvictCommunityTimes(gameId);

        return ToDto(playthrough, typeKeys);
    }

    public async Task<PlaythroughDto?> UpdateAsync(
        string userId,
        int gameId,
        int playthroughId,
        PlaythroughInputDto input,
        CancellationToken cancellationToken = default)
    {
        var typeKeys = await TypeKeysByIdAsync(cancellationToken);
        var typeId = ResolveTypeId(typeKeys, input.Type);

        var playthrough = await FindOwnedAsync(userId, gameId, playthroughId, cancellationToken);
        if (playthrough is null) return null;

        playthrough.TypeId = typeId;
        playthrough.PlatformId = input.PlatformId;
        playthrough.MinutesPlayed = input.MinutesPlayed;
        playthrough.StartedOn = input.StartedOn;
        playthrough.FinishedOn = input.FinishedOn;
        playthrough.Notes = Trimmed(input.Notes);
        playthrough.UpdatedAt = clock.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);

        EvictCommunityTimes(gameId);

        return ToDto(playthrough, typeKeys);
    }

    public async Task<bool> DeleteAsync(
        string userId, int gameId, int playthroughId, CancellationToken cancellationToken = default)
    {
        var playthrough = await FindOwnedAsync(userId, gameId, playthroughId, cancellationToken);
        if (playthrough is null) return false;

        db.UserGamePlaythroughs.Remove(playthrough);
        await db.SaveChangesAsync(cancellationToken);

        EvictCommunityTimes(gameId);
        return true;
    }

    public async Task<CommunityTimesDto> GetCommunityTimesAsync(
        int gameId, CancellationToken cancellationToken = default)
    {
        if (cache.TryGetValue<CommunityTimesDto>(CommunityTimesKey(gameId), out var cached)
            && cached is not null)
        {
            return cached;
        }

        var types = await db.PlaythroughTypes
            .AsNoTracking()
            .OrderBy(t => t.SortOrder)
            .ToListAsync(cancellationToken);

        // Only playthroughs that say both how they were played and for how long. An untyped run
        // has no tier to belong to, and one with no duration has nothing to contribute — counting
        // either would inflate a sample size behind a figure it did not help produce.
        var rows = await db.UserGamePlaythroughs
            .AsNoTracking()
            .Where(p => p.Entry.GameId == gameId && p.TypeId != null && p.MinutesPlayed != null)
            .Select(p => new { p.TypeId, p.MinutesPlayed })
            .ToListAsync(cancellationToken);

        // Aggregated in C# rather than by GROUP BY, following ADR 0023: the tests run on the
        // in-memory provider, so a median computed in SQL would be verified against something
        // PostgreSQL never runs, while the same arithmetic here is exercised exactly as it ships.
        var byType = rows
            .GroupBy(p => p.TypeId!.Value)
            .ToDictionary(g => g.Key, g => g.Select(p => p.MinutesPlayed!.Value).ToList());

        var buckets = types
            .Select(type => byType.TryGetValue(type.Id, out var minutes)
                ? new CommunityTimeBucketDto(type.Key, minutes.Count, Median(minutes))
                : new CommunityTimeBucketDto(type.Key, 0, null))
            .ToList();

        var result = new CommunityTimesDto(buckets);
        cache.Set(CommunityTimesKey(gameId), result, CommunityTimesTtl);
        return result;
    }

    /// <summary>
    /// One of the user's own playthroughs of one game, tracked so it can be changed.
    /// </summary>
    /// <remarks>
    /// The <c>UserId</c> predicate is the whole of the authorization: another account's
    /// playthrough is simply not found, which is why every caller can report a plain 404 without
    /// distinguishing "missing" from "not yours". The game id is checked too, so a valid id
    /// smuggled in under the wrong game does not resolve either.
    /// </remarks>
    private Task<UserGamePlaythrough?> FindOwnedAsync(
        string userId, int gameId, int playthroughId, CancellationToken cancellationToken) =>
        db.UserGamePlaythroughs
            .FirstOrDefaultAsync(
                p => p.Id == playthroughId && p.UserId == userId && p.Entry.GameId == gameId,
                cancellationToken);

    /// <summary>
    /// A type key turned into its seeded id. Null in, null out — an untyped playthrough is a run
    /// the user has not finished forming an opinion about.
    /// </summary>
    /// <remarks>
    /// Resolved against the same three rows the write turns back into a key afterwards, so a write
    /// reads the lookup once rather than once per direction. <c>[AllowedValues]</c> on the input
    /// DTO has already rejected an unrecognised key with a 400; this throws for the case that
    /// attribute cannot see, which is a key the DTO allows and the database has never been seeded
    /// with.
    /// </remarks>
    /// <exception cref="ArgumentException">The key is not one of the seeded types.</exception>
    private static short? ResolveTypeId(IReadOnlyDictionary<short, string> typeKeys, string? key)
    {
        if (string.IsNullOrEmpty(key)) return null;

        foreach (var (id, seeded) in typeKeys)
            if (seeded == key) return id;

        throw new ArgumentException($"Unknown playthrough type: {key}", nameof(key));
    }

    private async Task<IReadOnlyDictionary<short, string>> TypeKeysByIdAsync(
        CancellationToken cancellationToken) =>
        await db.PlaythroughTypes
            .AsNoTracking()
            .ToDictionaryAsync(t => t.Id, t => t.Key, cancellationToken);

    private static PlaythroughDto ToDto(
        UserGamePlaythrough playthrough, IReadOnlyDictionary<short, string> typeKeys) =>
        ToDto(
            new PlaythroughRow(
                playthrough.Id, playthrough.TypeId, playthrough.PlatformId, playthrough.MinutesPlayed,
                playthrough.StartedOn, playthrough.FinishedOn, playthrough.Notes,
                playthrough.CreatedAt, playthrough.UpdatedAt),
            typeKeys);

    /// <remarks>
    /// The type travels as its permanent <c>Key</c>, never the seeded id — the same rule the
    /// export follows, and for the same reason: the ids mean nothing outside this database.
    /// </remarks>
    private static PlaythroughDto ToDto(PlaythroughRow row, IReadOnlyDictionary<short, string> typeKeys) =>
        new(
            row.Id,
            row.TypeId is short id && typeKeys.TryGetValue(id, out var key) ? key : null,
            row.PlatformId,
            row.MinutesPlayed,
            row.StartedOn,
            row.FinishedOn,
            row.Notes,
            row.CreatedAt,
            row.UpdatedAt);

    /// <summary>Blank notes are no notes. An empty string would render as an empty paragraph.</summary>
    private static string? Trimmed(string? notes) =>
        string.IsNullOrWhiteSpace(notes) ? null : notes.Trim();

    /// <summary>
    /// The middle of a list of durations, averaging the two middle values for an even count —
    /// the same shape <c>StatsService</c> uses, on minutes rather than on a <c>TimeSpan</c>.
    /// </summary>
    private static int Median(List<int> minutes)
    {
        minutes.Sort();
        return minutes.Count % 2 == 1
            ? minutes[minutes.Count / 2]
            : (int)Math.Round((minutes[minutes.Count / 2 - 1] + minutes[minutes.Count / 2]) / 2.0);
    }

    private static string CommunityTimesKey(int gameId) => $"community_times|{gameId}";

    /// <summary>
    /// Drops a game's cached medians, so the member who just logged a playthrough sees it counted
    /// rather than waiting out a TTL for their own write.
    /// </summary>
    private void EvictCommunityTimes(int gameId) => cache.Remove(CommunityTimesKey(gameId));
}
