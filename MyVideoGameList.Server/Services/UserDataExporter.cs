using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Builds a user's data export by walking a manifest of every user-owned table.
/// </summary>
/// <remarks>
/// <para>
/// The manifest is the point of this class. <c>docs/data-model-plan.md</c> makes covering every
/// user-owned table an obligation that has to hold for tables added a year from now, and says the
/// fix is mechanical rather than diligent. So the sections are not written out one after another in
/// <see cref="ExportAsync"/> — they are registered in <see cref="Manifest"/>, keyed by entity type,
/// and <see cref="ExportAsync"/> walks it. <c>UserOwnedDataTests</c> then compares those keys
/// against the EF Core model in both directions, which turns "somebody forgot the new table" into a
/// failing build and "somebody deleted a table but left its registration" into one too.
/// </para>
/// <para>
/// Keyed by <see cref="Type"/> rather than by table name so the comparison is against the model
/// itself. A string registry would have to be kept in step with a rename by hand, which is the
/// class of mistake the guard exists to remove.
/// </para>
/// <para>
/// No IGDB call, and no game metadata. See <see cref="UserDataExportDto"/> for why, and
/// <c>docs/decisions/0024-the-ownership-contract.md</c> for the rest of the reasoning.
/// </para>
/// </remarks>
public class UserDataExporter(ApplicationDbContext db, TimeProvider clock) : IUserDataExporter
{
    /// <summary>
    /// How one user-owned table gets into the document: the JSON property it fills, and the read
    /// that fills it.
    /// </summary>
    /// <param name="Section">
    /// The property name in <see cref="UserDataExportDto"/>, as the serializer emits it. Carried
    /// for diagnostics and so that a registration reads as a claim about the document rather than
    /// as an anonymous delegate.
    /// </param>
    internal record ExportSection(
        string Section,
        Func<ApplicationDbContext, ExportDraft, CancellationToken, Task> ReadAsync);

    /// <summary>
    /// Every user-owned table, and how each one is exported.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>This is the only place a new user-owned table has to be registered.</b> Add one to the
    /// model without adding it here and <c>UserOwnedDataTests</c> fails.
    /// </para>
    /// <para>
    /// <see cref="ApplicationUser"/> is absent on purpose: it is not a table the user owns rows in,
    /// it is the user. It carries no <c>UserId</c> column, so the guard does not expect it here, and
    /// its two MVGL columns are read into <see cref="UserDataExportDto.Account"/> directly.
    /// <see cref="ListStatus"/> and <see cref="PlaythroughType"/> are absent because they are
    /// system-owned seed data — the export carries their keys, not their rows.
    /// </para>
    /// <para>
    /// Written with the add form rather than indexers so a duplicate registration throws at type
    /// load instead of quietly winning.
    /// </para>
    /// </remarks>
    internal static readonly IReadOnlyDictionary<Type, ExportSection> Manifest =
        new Dictionary<Type, ExportSection>
        {
            { typeof(UserGameEntry), new("entries", ReadEntriesAsync) },
            { typeof(UserGameEvent), new("events", ReadEventsAsync) },
            { typeof(UserGamePlaythrough), new("playthroughs", ReadPlaythroughsAsync) },
            { typeof(UserWishlistItem), new("wishlist", ReadWishlistAsync) },
            { typeof(UserHiddenPlatform), new("hiddenPlatformIds", ReadHiddenPlatformsAsync) },
            { typeof(UserListSortPreference), new("listSortPreferences", ReadListSortPreferencesAsync) },
        };

    /// <summary>
    /// The document under construction: what every section needs to read itself, and a slot per
    /// section to read itself into.
    /// </summary>
    /// <remarks>
    /// Mutable, unlike the DTO it becomes, because that is what lets each registration fill in its
    /// own section without <see cref="ExportAsync"/> knowing which sections exist. Every slot starts
    /// empty rather than null, so an unregistered section would export as "nothing recorded" — which
    /// is exactly the silent failure the guard test exists to catch before it can ship.
    /// </remarks>
    internal sealed class ExportDraft
    {
        public required string UserId { get; init; }

        /// <summary>
        /// Status id to permanent key. Read once and shared by the sections that need it, because
        /// the entry table and the event log both hold ids and neither may export one.
        /// </summary>
        public required IReadOnlyDictionary<short, string> StatusKeys { get; init; }

        /// <summary>
        /// Playthrough type id to permanent key, read once for the same reason
        /// <see cref="StatusKeys"/> is: the rows hold ids and the document may not carry one.
        /// </summary>
        public required IReadOnlyDictionary<short, string> TypeKeys { get; init; }

        public IReadOnlyList<EntryExportDto> Entries { get; set; } = [];
        public IReadOnlyList<EventExportDto> Events { get; set; } = [];
        public IReadOnlyList<PlaythroughExportDto> Playthroughs { get; set; } = [];
        public IReadOnlyList<WishlistExportDto> Wishlist { get; set; } = [];
        public IReadOnlyList<int> HiddenPlatformIds { get; set; } = [];
        public IReadOnlyList<ListSortExportDto> ListSortPreferences { get; set; } = [];

        public UserDataExportDto ToDocument(DateTimeOffset exportedAt, AccountExportDto account) =>
            new(exportedAt, account, Entries, Events, Playthroughs, Wishlist, HiddenPlatformIds,
                ListSortPreferences);
    }

    public async Task<UserDataExportDto> ExportAsync(string userId, CancellationToken cancellationToken)
    {
        var account = await db.Users
            .AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new AccountExportDto(u.Email, u.Theme, u.ListView))
            .SingleOrDefaultAsync(cancellationToken);

        // The caller is authenticated, so a missing row means the account was deleted underneath
        // this request. Failing loudly beats handing back a document about an account that no
        // longer exists.
        if (account is null)
            throw new InvalidOperationException($"No account row for user '{userId}'.");

        var draft = new ExportDraft
        {
            UserId = userId,
            StatusKeys = await db.ListStatuses
                .AsNoTracking()
                .ToDictionaryAsync(s => s.Id, s => s.Key, cancellationToken),
            TypeKeys = await db.PlaythroughTypes
                .AsNoTracking()
                .ToDictionaryAsync(t => t.Id, t => t.Key, cancellationToken)
        };

        // Walking the manifest rather than calling the five readers in a row is what makes
        // registration the single act that puts a table in the export.
        foreach (var section in Manifest.Values)
            await section.ReadAsync(db, draft, cancellationToken);

        return draft.ToDocument(clock.GetUtcNow(), account);
    }

    /// <remarks>
    /// Ordered oldest first, then by game, so two exports of unchanged data are byte-identical and
    /// can be diffed. The database's own order is not defined and would not be.
    /// </remarks>
    private static async Task ReadEntriesAsync(
        ApplicationDbContext db, ExportDraft draft, CancellationToken cancellationToken)
    {
        var rows = await db.UserGameEntries
            .AsNoTracking()
            .Where(e => e.UserId == draft.UserId)
            .OrderBy(e => e.AddedAt)
            .ThenBy(e => e.GameId)
            .Select(e => new { e.GameId, e.StatusId, e.Score, e.AddedAt, e.StatusChangedAt })
            .ToListAsync(cancellationToken);

        draft.Entries = rows
            .Select(e => new EntryExportDto(
                e.GameId, Key(draft, e.StatusId), e.Score, e.AddedAt, e.StatusChangedAt))
            .ToList();
    }

    /// <remarks>
    /// Ordered by the clock and then by the key, matching <see cref="StatsService"/>: two events can
    /// share a timestamp, and the log only means anything read in the order things happened.
    /// </remarks>
    private static async Task ReadEventsAsync(
        ApplicationDbContext db, ExportDraft draft, CancellationToken cancellationToken)
    {
        var rows = await db.UserGameEvents
            .AsNoTracking()
            .Where(e => e.UserId == draft.UserId)
            .OrderBy(e => e.OccurredAt)
            .ThenBy(e => e.Id)
            .Select(e => new { e.GameId, e.FromStatusId, e.ToStatusId, e.OccurredAt })
            .ToListAsync(cancellationToken);

        draft.Events = rows
            .Select(e => new EventExportDto(
                e.GameId, Key(draft, e.FromStatusId), Key(draft, e.ToStatusId), e.OccurredAt))
            .ToList();
    }

    /// <remarks>
    /// Joined to the entry for the game id, which is what identifies the playthrough's subject
    /// outside this database. Ordered oldest first, then by the key, so two exports of unchanged
    /// data are byte-identical.
    /// </remarks>
    private static async Task ReadPlaythroughsAsync(
        ApplicationDbContext db, ExportDraft draft, CancellationToken cancellationToken)
    {
        var rows = await db.UserGamePlaythroughs
            .AsNoTracking()
            .Where(p => p.UserId == draft.UserId)
            .OrderBy(p => p.CreatedAt)
            .ThenBy(p => p.Id)
            .Select(p => new
            {
                p.Entry.GameId,
                p.TypeId,
                p.PlatformId,
                p.MinutesPlayed,
                p.StartedOn,
                p.FinishedOn,
                p.Notes,
                p.CreatedAt,
                p.UpdatedAt
            })
            .ToListAsync(cancellationToken);

        draft.Playthroughs = rows
            .Select(p => new PlaythroughExportDto(
                p.GameId,
                p.TypeId is short id && draft.TypeKeys.TryGetValue(id, out var key) ? key : null,
                p.PlatformId,
                p.MinutesPlayed,
                p.StartedOn,
                p.FinishedOn,
                p.Notes,
                p.CreatedAt,
                p.UpdatedAt))
            .ToList();
    }

    private static async Task ReadWishlistAsync(
        ApplicationDbContext db, ExportDraft draft, CancellationToken cancellationToken)
    {
        draft.Wishlist = await db.UserWishlistItems
            .AsNoTracking()
            .Where(w => w.UserId == draft.UserId)
            .OrderBy(w => w.AddedAt)
            .ThenBy(w => w.GameId)
            .Select(w => new WishlistExportDto(w.GameId, w.AddedAt))
            .ToListAsync(cancellationToken);
    }

    /// <remarks>
    /// Bare IGDB platform ids, because that is the whole row: the table is a set of ids the user has
    /// switched off, with nothing else to say about any of them.
    /// </remarks>
    private static async Task ReadHiddenPlatformsAsync(
        ApplicationDbContext db, ExportDraft draft, CancellationToken cancellationToken)
    {
        draft.HiddenPlatformIds = await db.UserHiddenPlatforms
            .AsNoTracking()
            .Where(hp => hp.UserId == draft.UserId)
            .OrderBy(hp => hp.IgdbPlatformId)
            .Select(hp => hp.IgdbPlatformId)
            .ToListAsync(cancellationToken);
    }

    /// <remarks>
    /// Ordered by status id, which the seed makes lifecycle order — Backlog first, Dropped last —
    /// so the section reads the way the lists do in the UI.
    /// </remarks>
    private static async Task ReadListSortPreferencesAsync(
        ApplicationDbContext db, ExportDraft draft, CancellationToken cancellationToken)
    {
        var rows = await db.UserListSortPreferences
            .AsNoTracking()
            .Where(p => p.UserId == draft.UserId)
            .OrderBy(p => p.StatusId)
            .Select(p => new { p.StatusId, p.SortKey, p.Descending })
            .ToListAsync(cancellationToken);

        // A preference means nothing without the list it applies to, and its status is a
        // non-nullable foreign key, so PostgreSQL cannot hold an unresolvable one. Skipping rather
        // than exporting a null status keeps the promise that every key in the document is a key
        // something could be imported against.
        draft.ListSortPreferences = rows
            .Select(p => new { Status = Key(draft, p.StatusId), p.SortKey, p.Descending })
            .Where(p => p.Status is not null)
            .Select(p => new ListSortExportDto(p.Status!, p.SortKey, p.Descending))
            .ToList();
    }

    /// <summary>
    /// A status id turned back into its permanent key. Null in, null out — a null status is a real
    /// value on both the entry and the event log, meaning "in no list at all".
    /// </summary>
    private static string? Key(ExportDraft draft, short? statusId) =>
        statusId is short id && draft.StatusKeys.TryGetValue(id, out var key) ? key : null;
}
