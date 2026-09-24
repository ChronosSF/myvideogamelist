using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Importing another tracker's export: parse it, let the user look at it, then write it.
/// </summary>
/// <remarks>
/// The one place in the application allowed to write a status without an event, and the reason
/// that exemption is confined to a service of its own (ADR 0026, ADR 0037). Everything it writes,
/// it writes in a single <c>SaveChangesAsync</c>, so a commit either happens or does not.
/// </remarks>
public class ImportService(
    ApplicationDbContext db,
    IGameCacheService gameCache,
    TimeProvider clock) : IImportService
{
    /// <summary>
    /// The presets. Data rather than classes was the spec's promise and is still the shape here —
    /// a new service is a new <see cref="IImportSource"/> and this line, with nothing downstream
    /// of it changing.
    /// </summary>
    private static readonly IImportSource[] Sources = [new GrouveeImportSource()];

    /// <summary>
    /// Five thousand rows (§S7). Generous against a real export — the one this was built from has
    /// 617 — and low enough that a job cannot be used to fill the database.
    /// </summary>
    internal const int MaxRows = 5000;

    /// <summary>
    /// Five megabytes (§S7), checked here as well as by the endpoint's own limit, because the
    /// service is callable without going through the endpoint.
    /// </summary>
    internal const int MaxBytes = 5 * 1024 * 1024;

    /// <summary>
    /// How many unreviewed jobs one account may stack up. Not an entitlement — the spec's
    /// three-a-month proposal is a pricing decision and is deliberately not implemented here — but
    /// a bound on how much unreviewed jsonb one account can leave lying around.
    /// </summary>
    internal const int MaxPendingJobs = 3;

    /// <summary>How much of the file a preset is shown when asked whether it recognises it.</summary>
    private const int SniffLength = 2048;

    /// <summary>
    /// The <c>UserGameEntry.Notes</c> column's length, which an imported note is cut to rather than
    /// allowed to fail the commit against.
    /// </summary>
    private const int MaxNotesLength = 2000;

    public async Task<ImportJobDto> CreateJobAsync(
        string userId, string fileName, string content, CancellationToken cancellationToken = default)
    {
        if (content.Length > MaxBytes)
            throw new ImportRejectedException("That file is larger than 5 MB.");

        if (string.IsNullOrWhiteSpace(content))
            throw new ImportRejectedException("That file is empty.");

        var pending = await db.ImportJobs
            .CountAsync(j => j.UserId == userId && j.State == ImportJobStates.Pending, cancellationToken);

        if (pending >= MaxPendingJobs)
            throw new ImportRejectedException(
                $"You have {pending} imports waiting to be reviewed. Finish or cancel one before starting another.");

        var name = SafeFileName(fileName);
        var source = Detect(name, content)
            ?? throw new ImportRejectedException(
                "That file is not an export MyVideoGameList recognises. Grouvee's JSON or CSV export is supported.");

        // Parsing is the only thing that can reject the file on its contents, and it happens before
        // a row is written: a file that fails here leaves no job behind to clean up.
        IReadOnlyList<ImportRowPayload> payloads;
        try
        {
            payloads = source.Read(content);
        }
        catch (ImportParseException e)
        {
            throw new ImportRejectedException(e.Message);
        }

        if (payloads.Count == 0)
            throw new ImportRejectedException("That export has no games in it.");

        if (payloads.Count > MaxRows)
            throw new ImportRejectedException(
                $"That export has {payloads.Count} games, and the limit is {MaxRows}.");

        var now = clock.GetUtcNow();

        var job = new ImportJob
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Source = source.Key,
            FileName = name,
            State = ImportJobStates.Pending,
            RowCount = payloads.Count,
            CreatedAt = now,
            UpdatedAt = now
        };

        db.ImportJobs.Add(job);

        // Which of these games the user already has, so an existing entry is never overwritten
        // without being opted into per row (§S8). Read once here rather than per row.
        var tracked = await TrackedGameIdsAsync(
            userId,
            payloads.Where(p => p.GameId is not null).Select(p => p.GameId!.Value).Distinct().ToList(),
            cancellationToken);

        foreach (var payload in payloads)
        {
            // Matched means the file named an IGDB game, and nothing here asks IGDB whether it
            // agrees. That is deliberate: resolving 600 ids at upload would put a third party in
            // the path of storing somebody's file, and an outage would then turn a whole import
            // into "nothing matched". Metadata is attached later, for display, and its absence
            // costs a thumbnail rather than a row (ADR 0035 already makes an unresolvable id a
            // supported state).
            var matched = payload.GameId is not null;
            var conflicts = payload.GameId is { } id && tracked.Contains(id);

            db.ImportRows.Add(new ImportRow
            {
                UserId = userId,
                Job = job,
                SourceRef = payload.SourceRef is { } reference ? Truncate(reference, 64) : null,
                Title = Truncate(payload.Title, 512),
                GameId = payload.GameId,
                MatchKind = matched ? ImportMatchKinds.Matched : ImportMatchKinds.Unmatched,

                // Only matched rows with nothing in their way are pre-checked (§M3). An unmatched
                // row needs the user to say which game it is before it can mean anything, and a
                // row whose game they already track would overwrite what they recorded by hand.
                Decision = matched && !conflicts ? ImportDecisions.Import : ImportDecisions.Skip,
                Payload = ImportPayloadJson.Write(payload)
            });
        }

        await db.SaveChangesAsync(cancellationToken);
        return ToDto(job);
    }

    public async Task<IReadOnlyList<ImportJobDto>> GetJobsAsync(
        string userId, CancellationToken cancellationToken = default) =>
        await db.ImportJobs
            .AsNoTracking()
            .Where(j => j.UserId == userId)
            .OrderByDescending(j => j.CreatedAt)
            .Select(j => new ImportJobDto(
                j.Id, j.Source, j.FileName, j.State, j.RowCount, j.ImportedCount, j.SkippedCount,
                j.CreatedAt, j.CompletedAt))
            .ToListAsync(cancellationToken);

    public async Task<ImportReviewDto?> GetReviewAsync(
        string userId, Guid jobId, CancellationToken cancellationToken = default)
    {
        var job = await db.ImportJobs
            .AsNoTracking()
            .FirstOrDefaultAsync(j => j.Id == jobId && j.UserId == userId, cancellationToken);

        if (job is null) return null;

        var rows = await db.ImportRows
            .AsNoTracking()
            .Where(r => r.ImportJobId == jobId && r.UserId == userId)
            .OrderBy(r => r.Id)
            .ToListAsync(cancellationToken);

        var gameIds = rows.Where(r => r.GameId is not null).Select(r => r.GameId!.Value).Distinct().ToList();

        // Through the cache rather than IGDB, so the review renders during an outage — the same
        // reason a list does (ADR 0035).
        var games = (await gameCache.GetGamesAsync(gameIds, cancellationToken)).ToDictionary(g => g.Id);
        var tracked = await TrackedGameIdsAsync(userId, gameIds, cancellationToken);

        var dtos = rows.Select(row => ToReviewDto(row, games, tracked)).ToList();

        var summary = new ImportReviewSummaryDto(
            Total: dtos.Count,
            Matched: dtos.Count(r => r.MatchKind == ImportMatchKinds.Matched),
            Unmatched: dtos.Count(r => r.MatchKind == ImportMatchKinds.Unmatched),
            StatusUnrecognised: dtos.Count(r => r.StatusUnrecognised),
            AlreadyTracked: dtos.Count(r => r.AlreadyTracked),
            Selected: dtos.Count(r => r.Decision == ImportDecisions.Import));

        return new ImportReviewDto(ToDto(job), summary, dtos);
    }

    public async Task<bool> SetDecisionsAsync(
        string userId, Guid jobId, ImportDecisionsDto decisions, CancellationToken cancellationToken = default)
    {
        var job = await db.ImportJobs
            .FirstOrDefaultAsync(j => j.Id == jobId && j.UserId == userId, cancellationToken);

        if (job is null || job.State != ImportJobStates.Pending) return false;

        var wanted = decisions.Rows.ToDictionary(r => r.RowId);

        // Scoped to the job and the user in the predicate, so a row id belonging to somebody else's
        // job simply is not found — the scoping is the authorization.
        var rows = await db.ImportRows
            .Where(r => r.ImportJobId == jobId && r.UserId == userId && wanted.Keys.Contains(r.Id))
            .ToListAsync(cancellationToken);

        var statuses = await StatusKeysAsync(cancellationToken);

        foreach (var row in rows)
        {
            var decision = wanted[row.Id];

            row.Decision = decision.Decision == ImportDecisions.Import
                ? ImportDecisions.Import
                : ImportDecisions.Skip;

            // Picking a game for an unmatched row is what makes it importable (§M4).
            if (decision.GameId is { } gameId)
            {
                row.GameId = gameId;
                row.MatchKind = ImportMatchKinds.Matched;
            }

            if (decision.Status is { } status && statuses.Contains(status))
                row.Payload = ImportPayloadJson.Write(
                    ImportPayloadJson.Read(row.Payload) with { Status = status, StatusUnrecognised = false });
        }

        // Working on a review is what keeps it alive: the retention sweep measures a pending job
        // from this, not from when the file was uploaded, so somebody can take a fortnight per
        // sitting rather than a fortnight in total.
        job.UpdatedAt = clock.GetUtcNow();

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    public async Task<ImportResultDto?> CommitAsync(
        string userId, Guid jobId, CancellationToken cancellationToken = default)
    {
        var job = await db.ImportJobs
            .FirstOrDefaultAsync(j => j.Id == jobId && j.UserId == userId, cancellationToken);

        if (job is null || job.State != ImportJobStates.Pending) return null;

        var rows = await db.ImportRows
            .AsNoTracking()
            .Where(r => r.ImportJobId == jobId && r.UserId == userId)
            .OrderBy(r => r.Id)
            .ToListAsync(cancellationToken);

        var skipped = new List<ImportSkippedRowDto>();
        var wanted = new List<(ImportRow Row, ImportRowPayload Payload)>();

        foreach (var row in rows)
        {
            var payload = ImportPayloadJson.Read(row.Payload);

            if (row.Decision != ImportDecisions.Import)
            {
                skipped.Add(new ImportSkippedRowDto(row.Title, payload.SourceStatus, "You chose not to import it."));
                continue;
            }

            if (row.GameId is null)
            {
                skipped.Add(new ImportSkippedRowDto(row.Title, payload.SourceStatus, "No game was matched to it."));
                continue;
            }

            wanted.Add((row, payload));
        }

        var imported = await WriteAsync(userId, job.Source, wanted, cancellationToken);

        var now = clock.GetUtcNow();

        job.State = ImportJobStates.Done;
        job.ImportedCount = imported;
        job.SkippedCount = skipped.Count;
        job.CompletedAt = now;
        job.UpdatedAt = now;

        // One SaveChanges for the entries, the playthroughs, the two axes and the job's own
        // closing state, so a commit is one transaction (§S8) without an explicit one.
        await db.SaveChangesAsync(cancellationToken);

        return new ImportResultDto(ToDto(job), skipped);
    }

    public async Task<bool> CancelAsync(
        string userId, Guid jobId, CancellationToken cancellationToken = default)
    {
        var job = await db.ImportJobs
            .FirstOrDefaultAsync(j => j.Id == jobId && j.UserId == userId, cancellationToken);

        if (job is null || job.State != ImportJobStates.Pending) return false;

        var now = clock.GetUtcNow();

        job.State = ImportJobStates.Cancelled;
        job.CompletedAt = now;
        job.UpdatedAt = now;

        await db.SaveChangesAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// Writes the chosen rows into the user's library. Adds to the context and does not save.
    /// </summary>
    /// <remarks>
    /// <b>No <see cref="UserGameEvent"/> is written here, and that is the point.</b> The source
    /// records a shelf, not a transition, so an event would carry the import's own timestamp and
    /// become permanent fabricated history in the one table no migration can reconstruct
    /// (ADR 0018, ADR 0026). <see cref="UserGameEntry.Origin"/> is what marks the exemption, and
    /// <c>StatusChangedAt</c> stays null so an imported library does not bury everything the user
    /// actually touched at the top of "recently moved".
    /// </remarks>
    private async Task<int> WriteAsync(
        string userId,
        string source,
        IReadOnlyList<(ImportRow Row, ImportRowPayload Payload)> wanted,
        CancellationToken cancellationToken)
    {
        if (wanted.Count == 0) return 0;

        var gameIds = wanted.Select(w => w.Row.GameId!.Value).Distinct().ToList();

        // **Before anything is added to the context, and that order is load-bearing.**
        // `IGameCacheService` shares this scoped `DbContext` and calls `SaveChangesAsync` itself
        // when it refreshes a game from IGDB. Asking it after the entries were created would
        // commit them early — status-less, origin `manual`, carrying the wrong `AddedAt` — and a
        // later failure would leave that half-built import behind. Nothing of ours is pending
        // here, so its save is a no-op for this import.
        var games = (await gameCache.GetGamesAsync(gameIds, cancellationToken)).ToDictionary(g => g.Id);

        var statuses = await db.ListStatuses.AsNoTracking().ToDictionaryAsync(s => s.Key, s => s.Id, cancellationToken);

        var (entries, createdIds) = await EntryStore.FindOrCreateManyAsync(
            db, clock, userId, gameIds, cancellationToken);

        var existingRuns = await ExistingRunsAsync(userId, entries, createdIds, cancellationToken);
        var wishlisted = await AxisIdsAsync(db.UserWishlistItems, userId, gameIds, cancellationToken);
        var favourited = await AxisIdsAsync(db.UserFavourites, userId, gameIds, cancellationToken);

        var now = clock.GetUtcNow();
        var imported = 0;

        foreach (var (row, payload) in wanted)
        {
            var gameId = row.GameId!.Value;
            var entry = entries[gameId];

            // Only a row this commit created takes the source's date. Overwriting the AddedAt of
            // an entry the user already had would rewrite when *they* first recorded the game.
            if (createdIds.Contains(gameId) && payload.AddedAt is { } addedAt) entry.AddedAt = addedAt;

            if (payload.Status is { } key && statuses.TryGetValue(key, out var statusId))
            {
                entry.StatusId = statusId;

                // Marks the entry as one whose status may have no event behind it. Set whether the
                // row was created here or already existed: it is the eventless status being
                // flagged, not the row's parentage.
                entry.Origin = source;
            }

            // Only fills what is empty. An import is new information about a game, not a correction
            // of what its owner already recorded by hand.
            entry.Score ??= payload.Score;

            // Truncated to the column's length rather than left to fail. A Grouvee review can run
            // past 2,000 characters, and a note that long would abort the whole commit on the final
            // save — losing several hundred games over the tail of one note is the worse trade, and
            // the source file is still in the user's hands.
            entry.Notes ??= payload.Notes is { } notes ? Truncate(notes, MaxNotesLength) : null;

            foreach (var run in payload.Playthroughs)
            {
                // Re-importing the same file must not stack up a second copy of every run (§M7).
                if (!existingRuns.Add(RunKey(entry.GameId, run))) continue;

                db.UserGamePlaythroughs.Add(new UserGamePlaythrough
                {
                    UserId = userId,
                    Entry = entry,

                    // No TypeId, deliberately — ADR 0037 decision 4. A typed run carrying minutes
                    // feeds the community medians, and the source's completion field is a default
                    // rather than its owner's answer.
                    PlatformId = ResolvePlatform(run.PlatformName, games.GetValueOrDefault(gameId)),
                    MinutesPlayed = run.MinutesPlayed,
                    StartedOn = run.StartedOn,
                    FinishedOn = run.FinishedOn,
                    CreatedAt = now,
                    UpdatedAt = now
                });
            }

            // Both axes order by AddedAt and nothing else, so they take the source's date for the
            // reason the entry does: stamping the import's own would put an entire imported
            // wishlist at the top of it and bury everything the user actually wanted recently.
            var axisAddedAt = payload.AddedAt ?? now;

            if (payload.Wishlist && wishlisted.Add(gameId))
                db.UserWishlistItems.Add(new UserWishlistItem { UserId = userId, GameId = gameId, AddedAt = axisAddedAt });

            if (payload.Favourite && favourited.Add(gameId))
                db.UserFavourites.Add(new UserFavourite { UserId = userId, GameId = gameId, AddedAt = axisAddedAt });

            imported++;
        }

        return imported;
    }

    /// <summary>
    /// The IGDB platform id for a name the source gave us, found in the game's own platform list.
    /// </summary>
    /// <remarks>
    /// Against the cached game rather than a platform lookup, for two reasons. It needs no network
    /// call, so a commit does not depend on IGDB being reachable. And the candidate set is the
    /// platforms the game is actually on, which removes the ambiguity a global name match would
    /// have. Grouvee's names happen to be IGDB's own, which is what makes this work — a convenience
    /// rather than a contract, so a name that does not resolve leaves the run's platform null
    /// rather than failing it (ADR 0037).
    /// </remarks>
    private static int? ResolvePlatform(string? name, GameDto? game)
    {
        if (name is null || game is null) return null;

        return game.Platforms
            .FirstOrDefault(p => string.Equals(p.Name, name, StringComparison.OrdinalIgnoreCase))
            ?.Id;
    }

    /// <summary>
    /// Which of these games the user already has an entry for, so the review screen can mark them
    /// and default them to skip (§S8).
    /// </summary>
    private async Task<HashSet<int>> TrackedGameIdsAsync(
        string userId, IReadOnlyCollection<int> gameIds, CancellationToken cancellationToken) =>
        gameIds.Count == 0
            ? []
            : [.. await db.UserGameEntries
                .AsNoTracking()
                .Where(e => e.UserId == userId && gameIds.Contains(e.GameId))
                .Select(e => e.GameId)
                .ToListAsync(cancellationToken)];

    private static async Task<HashSet<int>> AxisIdsAsync<T>(
        DbSet<T> set, string userId, IReadOnlyCollection<int> gameIds, CancellationToken cancellationToken)
        where T : class, IGameAxisItem =>
        [.. await set
            .AsNoTracking()
            .Where(i => i.UserId == userId && gameIds.Contains(i.GameId))
            .Select(i => i.GameId)
            .ToListAsync(cancellationToken)];

    /// <summary>
    /// The runs the user already has for these games, as comparable keys, so an import run that
    /// duplicates one is not written twice.
    /// </summary>
    private async Task<HashSet<string>> ExistingRunsAsync(
        string userId,
        IReadOnlyDictionary<int, UserGameEntry> entries,
        IReadOnlySet<int> createdIds,
        CancellationToken cancellationToken)
    {
        // Only entries that already existed can have runs against them, and only those have a real
        // key to query by — a row added moments ago carries a temporary one.
        var entryIds = entries
            .Where(pair => !createdIds.Contains(pair.Key))
            .Select(pair => pair.Value.Id)
            .ToList();

        if (entryIds.Count == 0) return [];

        var rows = await db.UserGamePlaythroughs
            .AsNoTracking()
            .Where(p => p.UserId == userId && entryIds.Contains(p.UserGameEntryId))
            .Select(p => new { p.Entry.GameId, p.StartedOn, p.FinishedOn, p.MinutesPlayed })
            .ToListAsync(cancellationToken);

        return [.. rows.Select(r => RunKey(
            r.GameId, new ImportPlaythroughPayload(r.StartedOn, r.FinishedOn, r.MinutesPlayed, null)))];
    }

    /// <summary>
    /// What makes two runs the same run: the game, the dates and the duration. Not the platform —
    /// the source may or may not have said, and an import that ran twice should not produce a
    /// second copy because the second pass resolved a platform name the first did not.
    /// </summary>
    private static string RunKey(int gameId, ImportPlaythroughPayload run) =>
        $"{gameId}|{run.StartedOn:O}|{run.FinishedOn:O}|{run.MinutesPlayed}";

    private async Task<HashSet<string>> StatusKeysAsync(CancellationToken cancellationToken) =>
        [.. await db.ListStatuses.AsNoTracking().Select(s => s.Key).ToListAsync(cancellationToken)];

    /// <summary>
    /// Which preset recognises this file, from its name and its first bytes — the header
    /// fingerprint of §3, and what makes sniffing the content rather than trusting the extension
    /// (§S7) possible.
    /// </summary>
    /// <remarks>
    /// A written-out loop rather than <c>Array.Find</c>: the head is a <c>ReadOnlySpan</c>, which
    /// cannot be captured by a lambda, and copying it to a string per candidate would be the only
    /// alternative.
    /// </remarks>
    private static IImportSource? Detect(string fileName, string content)
    {
        var head = content.AsSpan(0, Math.Min(SniffLength, content.Length));

        foreach (var source in Sources)
            if (source.CanRead(fileName, head))
                return source;

        return null;
    }

    /// <summary>
    /// The uploaded name, reduced to something safe to store and render.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Any directory part is dropped: a browser should not send one, and a name this application
    /// never opens still should not carry a path it could later be mistaken for. Bounded to the
    /// column's length so a long name is truncated here rather than by the database.
    /// </para>
    /// <para>
    /// Both separators are cut explicitly, rather than by <c>Path.GetFileName</c>. That method
    /// follows the rules of the <em>host</em>: on Linux, which is where this is deployed, a
    /// backslash is an ordinary filename character, so it hands back a Windows path whole. The name
    /// comes from whichever machine the browser is on, and from a client free to send anything at
    /// all, so which characters separate directories is a property of the input and never of the
    /// server. Running the tests only on Windows is what hid this.
    /// </para>
    /// </remarks>
    private static string SafeFileName(string? fileName)
    {
        var trimmed = fileName?.Trim() ?? string.Empty;

        var cut = trimmed.LastIndexOfAny(['/', '\\']);
        var name = cut >= 0 ? trimmed[(cut + 1)..] : trimmed;

        return string.IsNullOrWhiteSpace(name) ? "import" : Truncate(name, 260);
    }

    private static string Truncate(string value, int length) =>
        value.Length <= length ? value : value[..length];

    private static ImportReviewRowDto ToReviewDto(
        ImportRow row, IReadOnlyDictionary<int, GameDto> games, IReadOnlySet<int> tracked)
    {
        var payload = ImportPayloadJson.Read(row.Payload);

        return new ImportReviewRowDto(
            Id: row.Id,
            Title: row.Title,
            ReleaseYear: payload.ReleaseYear,
            GameId: row.GameId,
            Game: row.GameId is { } id ? games.GetValueOrDefault(id) : null,
            MatchKind: row.MatchKind,
            Decision: row.Decision,
            SourceStatus: payload.SourceStatus,
            Status: payload.Status,
            StatusUnrecognised: payload.StatusUnrecognised,
            Score: payload.Score,
            Wishlist: payload.Wishlist,
            Favourite: payload.Favourite,
            HasNotes: payload.Notes is not null,
            PlaythroughCount: payload.Playthroughs.Count,
            MinutesPlayed: payload.Playthroughs.Sum(p => p.MinutesPlayed ?? 0) is var minutes and > 0 ? minutes : null,
            AlreadyTracked: row.GameId is { } gameId && tracked.Contains(gameId));
    }

    private static ImportJobDto ToDto(ImportJob job) =>
        new(job.Id, job.Source, job.FileName, job.State, job.RowCount, job.ImportedCount,
            job.SkippedCount, job.CreatedAt, job.CompletedAt);
}
