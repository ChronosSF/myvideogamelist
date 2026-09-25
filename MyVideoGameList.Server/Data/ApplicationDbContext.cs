using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Data;

/// <summary>
/// Stores user-owned data only. Game metadata is not modelled here: IGDB is the source of
/// truth, and <see cref="UserGameEntry.GameId"/> holds an IGDB id rather than a local key.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="ListStatuses"/> and <see cref="PlaythroughTypes"/> are the exceptions to "user-owned
/// data only": both are small system-owned lookups seeded by a migration, and they are what the
/// other tables key against.
/// </para>
/// <para>
/// <see cref="CachedGames"/> is the third exception and a different kind: a copy of what IGDB
/// answered, keyed on IGDB's own id, so that a shelf of somebody's games renders while IGDB is
/// unreachable. It is not a catalogue and nothing keys against it.
/// </para>
/// </remarks>
public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<CachedGame> CachedGames { get; set; }
    public DbSet<ImportJob> ImportJobs { get; set; }
    public DbSet<ImportRow> ImportRows { get; set; }
    public DbSet<ListStatus> ListStatuses { get; set; }
    public DbSet<PlaythroughType> PlaythroughTypes { get; set; }
    public DbSet<Review> Reviews { get; set; }
    public DbSet<UserFavourite> UserFavourites { get; set; }
    public DbSet<UserGameEntry> UserGameEntries { get; set; }
    public DbSet<UserGameEvent> UserGameEvents { get; set; }
    public DbSet<UserGamePlaythrough> UserGamePlaythroughs { get; set; }
    public DbSet<UserHiddenPlatform> UserHiddenPlatforms { get; set; }
    public DbSet<UserListSetting> UserListSettings { get; set; }
    public DbSet<UserListSortPreference> UserListSortPreferences { get; set; }
    public DbSet<UserWishlistItem> UserWishlistItems { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        ConfigureApplicationUsers(modelBuilder);
        ConfigureCachedGames(modelBuilder);
        ConfigureListStatuses(modelBuilder);
        ConfigurePlaythroughTypes(modelBuilder);

        // UserGameEntry: surrogate PK, with (UserId, GameId) kept unique by index rather than by
        // being the key. Children — playthroughs, reviews, tags — hang off the single column;
        // cascade delete when the user is deleted.
        modelBuilder.Entity<UserGameEntry>().HasKey(e => e.Id);

        // An alternate key on (Id, UserId), which is what lets a child point at the entry *and*
        // its owner in one foreign key. Uniqueness is already guaranteed by Id alone, so this
        // constrains nothing new; it exists only to be referenced.
        modelBuilder.Entity<UserGameEntry>().HasAlternateKey(e => new { e.Id, e.UserId });

        modelBuilder.Entity<UserGameEntry>().HasIndex(e => new { e.UserId, e.GameId }).IsUnique();
        modelBuilder.Entity<UserGameEntry>()
            .HasOne(e => e.User)
            .WithMany()
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict, not cascade: statuses are seeded reference data and deleting one would take
        // every entry using it with it. Adding a status is fine; removing one should fail loudly.
        modelBuilder.Entity<UserGameEntry>()
            .HasOne(e => e.Status)
            .WithMany()
            .HasForeignKey(e => e.StatusId)
            .OnDelete(DeleteBehavior.Restrict);

        // A score out of 10 and an ownership from the known set, both enforced by the database as
        // well as by the API — the columns outlive any one validation attribute. The notes are
        // bounded to the playthrough notes' length, for the same reason.
        modelBuilder.Entity<UserGameEntry>().Property(e => e.Ownership).HasMaxLength(16);
        modelBuilder.Entity<UserGameEntry>().Property(e => e.Notes).HasMaxLength(2000);

        // The default is stated to the database as well as in the CLR property, for the reason
        // ProfileVisibility's is: a row inserted by a fixture or a support script should carry the
        // honest value rather than an empty one. No check constraint on purpose — see
        // `EntryOrigins`, whose set is open by construction because every new import preset adds a
        // value, and a constraint would turn each one into a migration (ADR 0037).
        modelBuilder.Entity<UserGameEntry>()
            .Property(e => e.Origin)
            .HasMaxLength(32)
            .HasDefaultValue(EntryOrigins.Manual);
        modelBuilder.Entity<UserGameEntry>()
            .ToTable(t =>
            {
                t.HasCheckConstraint(
                    "CK_UserGameEntries_Score_Range", "\"Score\" IS NULL OR (\"Score\" >= 1 AND \"Score\" <= 10)");
                t.HasCheckConstraint(
                    "CK_UserGameEntries_Ownership",
                    "\"Ownership\" IS NULL OR \"Ownership\" IN ('owned', 'subscription', 'borrowed')");
            });

        // Sorting a list by "recently added" or "recently moved" is the default view, so both
        // sort keys are indexed per user.
        modelBuilder.Entity<UserGameEntry>().HasIndex(e => new { e.UserId, e.AddedAt });
        modelBuilder.Entity<UserGameEntry>().HasIndex(e => new { e.UserId, e.StatusChangedAt });

        // One game across every user — the question every community read asks, and the one no
        // other index here can answer: they all lead with UserId, so without this each of those
        // reads walks the whole table. GameId leads so the member reviews and the community times
        // can select a game's entries and join in from them; Score rides along so the score
        // distribution is read from the index alone. See ADR 0028.
        modelBuilder.Entity<UserGameEntry>().HasIndex(e => new { e.GameId, e.Score });

        ConfigureUserGameEvents(modelBuilder);
        ConfigureUserGamePlaythroughs(modelBuilder);
        ConfigureReviews(modelBuilder);
        ConfigureImports(modelBuilder);

        // UserListSortPreference: one row per (user, status); no row means the default sort
        modelBuilder.Entity<UserListSortPreference>().HasKey(p => new { p.UserId, p.StatusId });
        modelBuilder.Entity<UserListSortPreference>().Property(p => p.SortKey).HasMaxLength(32);
        modelBuilder.Entity<UserListSortPreference>()
            .HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<UserListSortPreference>()
            .HasOne(p => p.Status)
            .WithMany()
            .HasForeignKey(p => p.StatusId)
            .OnDelete(DeleteBehavior.Restrict);

        // UserListSetting: the sort preference's shape — one row per (user, status), and no row means
        // the default name. Restrict on the status for the same reason: renaming a list must never be
        // a way to delete one.
        modelBuilder.Entity<UserListSetting>().HasKey(s => new { s.UserId, s.StatusId });
        modelBuilder.Entity<UserListSetting>().Property(s => s.DisplayName).HasMaxLength(ListNamePolicy.MaxLength);
        modelBuilder.Entity<UserListSetting>()
            .HasOne(s => s.User)
            .WithMany()
            .HasForeignKey(s => s.UserId)
            .OnDelete(DeleteBehavior.Cascade);
        modelBuilder.Entity<UserListSetting>()
            .HasOne(s => s.Status)
            .WithMany()
            .HasForeignKey(s => s.StatusId)
            .OnDelete(DeleteBehavior.Restrict);

        // UserWishlistItem: an axis of its own, so no foreign key to UserGameEntry — a wishlisted
        // game usually has no entry yet. Composite PK is what makes wishlisting idempotent.
        modelBuilder.Entity<UserWishlistItem>().HasKey(w => new { w.UserId, w.GameId });
        modelBuilder.Entity<UserWishlistItem>()
            .HasOne(w => w.User)
            .WithMany()
            .HasForeignKey(w => w.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // The wishlist has one order that matters — most recently wanted first.
        modelBuilder.Entity<UserWishlistItem>().HasIndex(w => new { w.UserId, w.AddedAt });

        // UserFavourite: the wishlist's shape exactly, for the same reasons — an axis of its own, so
        // no foreign key to the entry, and a composite PK that makes favouriting idempotent.
        modelBuilder.Entity<UserFavourite>().HasKey(f => new { f.UserId, f.GameId });
        modelBuilder.Entity<UserFavourite>()
            .HasOne(f => f.User)
            .WithMany()
            .HasForeignKey(f => f.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Read in one order, newest first, by the owner and by their public profile alike.
        modelBuilder.Entity<UserFavourite>().HasIndex(f => new { f.UserId, f.AddedAt });

        // UserHiddenPlatform: composite PK on (UserId, IgdbPlatformId); cascade delete when user is deleted
        modelBuilder.Entity<UserHiddenPlatform>().HasKey(hp => new { hp.UserId, hp.IgdbPlatformId });
        modelBuilder.Entity<UserHiddenPlatform>()
            .HasOne(hp => hp.User)
            .WithMany()
            .HasForeignKey(hp => hp.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }

    /// <summary>
    /// The MVGL columns on Identity's user row.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <c>UserName</c> itself is left exactly as Identity declares it. It carries the public handle
    /// (ADR 0027) rather than a second column doing the same job, which means the case-insensitive
    /// unique index Identity already maintains over <c>NormalizedUserName</c> <em>is</em> the
    /// namespace constraint — there is no second uniqueness rule here to drift out of step with it.
    /// The shape rules live in <see cref="UserNamePolicy"/> and are enforced by Identity's own
    /// validator, which <c>Program.cs</c> configures from the same constants.
    /// </para>
    /// <para>
    /// The visibility check constraint is the counterpart of the one on <c>Reviews</c>: the column
    /// outlives any one validation attribute, and a row saying something other than public or
    /// private would silently be treated as private by every read that compares against a literal.
    /// </para>
    /// </remarks>
    private static void ConfigureApplicationUsers(ModelBuilder modelBuilder)
    {
        var users = modelBuilder.Entity<ApplicationUser>();

        // The default is stated to the database as well as in the CLR property, so a row inserted
        // by anything that is not this application — a fixture, a support script — is private too.
        // Defaulting to public in one of those places and private in the other is the shape of
        // mistake that publishes somebody's library without them ever being asked.
        users.Property(u => u.ProfileVisibility)
            .HasMaxLength(16)
            .HasDefaultValue(Models.ProfileVisibility.Private);

        users.ToTable(t => t.HasCheckConstraint(
            "CK_AspNetUsers_ProfileVisibility",
            "\"ProfileVisibility\" IN ('public', 'private')"));
    }

    private static void ConfigureListStatuses(ModelBuilder modelBuilder)
    {
        var statuses = modelBuilder.Entity<ListStatus>();

        // Ids are assigned here rather than generated: they are seeded constants referenced by
        // migrations and by the event log, so they must be stable across every environment.
        statuses.Property(s => s.Id).ValueGeneratedNever();
        statuses.Property(s => s.Key).HasMaxLength(32);
        statuses.Property(s => s.DefaultName).HasMaxLength(64);
        statuses.HasIndex(s => s.Key).IsUnique();

        statuses.HasData(
            new ListStatus
            {
                Id = 1, Key = ListStatusKeys.Backlog, DefaultName = "Backlog", SortOrder = 1,
                IsStarted = false, IsTerminal = false, CountsAsCompletion = false
            },
            new ListStatus
            {
                Id = 2, Key = ListStatusKeys.Playing, DefaultName = "Playing", SortOrder = 2,
                IsStarted = true, IsTerminal = false, CountsAsCompletion = false
            },
            new ListStatus
            {
                Id = 3, Key = ListStatusKeys.OnHold, DefaultName = "On Hold", SortOrder = 3,
                IsStarted = true, IsTerminal = false, CountsAsCompletion = false
            },
            new ListStatus
            {
                Id = 4, Key = ListStatusKeys.Finished, DefaultName = "Finished", SortOrder = 4,
                IsStarted = true, IsTerminal = true, CountsAsCompletion = true
            },
            new ListStatus
            {
                Id = 5, Key = ListStatusKeys.Dropped, DefaultName = "Dropped", SortOrder = 5,
                IsStarted = true, IsTerminal = true, CountsAsCompletion = false
            });
    }

    private static void ConfigureCachedGames(ModelBuilder modelBuilder)
    {
        var games = modelBuilder.Entity<CachedGame>();

        // The IGDB id, assigned rather than generated: this table copies their keyspace and never
        // invents one of its own.
        games.HasKey(g => g.GameId);
        games.Property(g => g.GameId).ValueGeneratedNever();

        // jsonb rather than text: it is the shape PostgreSQL indexes and queries if a later
        // feature needs to read inside the document, and it validates what is written.
        games.Property(g => g.Payload).HasColumnType("jsonb");

        games.Property(g => g.Title).HasMaxLength(512);
        games.Property(g => g.CoverImageUrl).HasMaxLength(512);

        // What a refresh job will order by, and what answers "how stale is this shelf".
        games.HasIndex(g => g.RefreshedAt);
    }

    private static void ConfigurePlaythroughTypes(ModelBuilder modelBuilder)
    {
        var types = modelBuilder.Entity<PlaythroughType>();

        // Assigned rather than generated, exactly as ListStatus is: these ids are seeded constants
        // referenced by every playthrough row, so they must be stable across every environment.
        types.Property(t => t.Id).ValueGeneratedNever();
        types.Property(t => t.Key).HasMaxLength(32);
        types.Property(t => t.DefaultName).HasMaxLength(64);
        types.HasIndex(t => t.Key).IsUnique();

        types.HasData(
            new PlaythroughType
            {
                Id = 1, Key = PlaythroughTypeKeys.Rushed, DefaultName = "Rushed", SortOrder = 1
            },
            new PlaythroughType
            {
                Id = 2, Key = PlaythroughTypeKeys.Normally, DefaultName = "Normally", SortOrder = 2
            },
            new PlaythroughType
            {
                Id = 3, Key = PlaythroughTypeKeys.Completionist, DefaultName = "Completionist", SortOrder = 3
            });
    }

    private static void ConfigureUserGamePlaythroughs(ModelBuilder modelBuilder)
    {
        var playthroughs = modelBuilder.Entity<UserGamePlaythrough>();

        playthroughs.HasKey(p => p.Id);
        playthroughs.Property(p => p.Notes).HasMaxLength(2000);

        // A direct foreign key to the account, even though the entry already leads there. The
        // ownership guard selects user-owned entities by the presence of a `UserId` property and
        // then insists on a cascading foreign key tied to that column; a child keyed only through
        // the entry would carry no such column and escape both the cascade and the export
        // registration without failing anything. See ADR 0024.
        playthroughs.HasOne(p => p.User)
            .WithMany()
            .HasForeignKey(p => p.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // The entry, referenced by (Id, UserId) rather than by Id alone. That makes "this
        // playthrough's owner is the entry's owner" a database constraint rather than a promise
        // the service has to keep — a row pointing at somebody else's entry cannot be written at
        // all. PostgreSQL is happy with the two overlapping cascade paths this creates.
        playthroughs.HasOne(p => p.Entry)
            .WithMany()
            .HasForeignKey(p => new { p.UserGameEntryId, p.UserId })
            .HasPrincipalKey(e => new { e.Id, e.UserId })
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict, as for statuses: types are seeded reference data, and deleting one should fail
        // loudly rather than take every playthrough that used it.
        playthroughs.HasOne(p => p.Type)
            .WithMany()
            .HasForeignKey(p => p.TypeId)
            .OnDelete(DeleteBehavior.Restrict);

        // Enforced by the database as well as by the input DTO, because the column outlives any
        // one validation attribute. 600,000 minutes is ten thousand hours — comfortably past any
        // honest figure and still short of a typo that would break a sum.
        playthroughs.ToTable(t =>
        {
            t.HasCheckConstraint(
                "CK_UserGamePlaythroughs_MinutesPlayed_Range",
                "\"MinutesPlayed\" IS NULL OR (\"MinutesPlayed\" >= 1 AND \"MinutesPlayed\" <= 600000)");
            t.HasCheckConstraint(
                "CK_UserGamePlaythroughs_Dates_Order",
                "\"StartedOn\" IS NULL OR \"FinishedOn\" IS NULL OR \"FinishedOn\" >= \"StartedOn\"");
        });

        // The user's own playthroughs, which is every read the panel makes.
        playthroughs.HasIndex(p => new { p.UserId, p.UserGameEntryId });

        // The community aggregate's access path is the one that is not obvious, so it is worth
        // stating: it asks about one *game* across all users, and the game id lives on the entry
        // rather than here. So it selects the entries for that game — through the entry's own
        // (GameId, Score) index — and joins in on UserGameEntryId. No index is declared for that
        // join here on purpose — the composite foreign key above already gets one on
        // (UserGameEntryId, UserId), which serves it as a leading-column prefix. A second index on
        // UserGameEntryId alone would be pure duplication.
    }

    private static void ConfigureReviews(ModelBuilder modelBuilder)
    {
        var reviews = modelBuilder.Entity<Review>();

        reviews.HasKey(r => r.Id);
        reviews.Property(r => r.Body).HasMaxLength(10000);
        reviews.Property(r => r.Visibility).HasMaxLength(16);

        // One review per user per game. The entry is already unique on (UserId, GameId), so a
        // unique index on the entry id is the whole of that constraint.
        reviews.HasIndex(r => r.UserGameEntryId).IsUnique();

        // The same two foreign keys a playthrough carries, for the same two reasons: the guard
        // keys on the UserId column, and the composite key makes "this review's owner is the
        // entry's owner" a database constraint rather than a service's promise.
        reviews.HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        reviews.HasOne(r => r.Entry)
            .WithMany()
            .HasForeignKey(r => new { r.UserGameEntryId, r.UserId })
            .HasPrincipalKey(e => new { e.Id, e.UserId })
            .OnDelete(DeleteBehavior.Cascade);

        // SetNull rather than Cascade: deleting the record of one run must not take the prose
        // somebody wrote about the game with it. The pointer was optional to begin with.
        reviews.HasOne(r => r.Playthrough)
            .WithMany()
            .HasForeignKey(r => r.PlaythroughId)
            .OnDelete(DeleteBehavior.SetNull);

        // Enforced by the database as well as by the input DTO, because the column outlives any
        // one validation attribute. A third value — `friends`, once following exists — is one
        // additive migration away.
        reviews.ToTable(t => t.HasCheckConstraint(
            "CK_Reviews_Visibility",
            "\"Visibility\" IN ('public', 'private')"));
    }

    /// <summary>
    /// The two import tables, which have the entry-and-child shape the playthroughs use.
    /// </summary>
    /// <remarks>
    /// Both are user-owned and both are registered in the export manifest. A row reaches its job
    /// through <c>(ImportJobId, UserId)</c> rather than through the job id alone, so that "this
    /// row's owner is the job's owner" is a database constraint rather than a promise the service
    /// has to keep — the same composite key a playthrough and a review carry (ADR 0025).
    /// </remarks>
    private static void ConfigureImports(ModelBuilder modelBuilder)
    {
        var jobs = modelBuilder.Entity<ImportJob>();

        jobs.HasKey(j => j.Id);
        jobs.Property(j => j.Source).HasMaxLength(32);
        jobs.Property(j => j.State).HasMaxLength(16);

        // Long enough for any real filename and short enough that a pathological one cannot be
        // used to bloat the row. Never a path — see ImportJob.FileName.
        jobs.Property(j => j.FileName).HasMaxLength(260);

        // The alternate key a row's composite foreign key points at. Uniqueness is already
        // guaranteed by Id alone; this exists only to be referenced, exactly as the entry's does.
        jobs.HasAlternateKey(j => new { j.Id, j.UserId });

        jobs.HasOne(j => j.User)
            .WithMany()
            .HasForeignKey(j => j.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // CompletedAt says whether a job is over; State says how it ended. That is two columns and
        // one fact, and the database is what keeps them agreeing: ImportService counts unfinished
        // jobs against MaxPendingJobs by CompletedAt and ImportRetention chooses its window from
        // the same column, so a row where the two disagree either holds a slot the sweep never
        // frees or is deleted under the rule written for the other kind.
        //
        // The terminal states are named rather than the whole set, so ImportJobStates keeps its
        // promise: adding `mapping` or `matching` for a preset that needs one is still additive
        // and free, because a state that is not terminal simply has no completion. Adding a new
        // *terminal* state is the one case that needs a migration, and it should be deliberate.
        jobs.ToTable(t => t.HasCheckConstraint(
            "CK_ImportJobs_Completion",
            "(\"State\" IN ('done', 'cancelled')) = (\"CompletedAt\" IS NOT NULL)"));

        // The only order anybody reads jobs in. Written when the retention sweep was still
        // hypothetical and guessed wrong about it: the sweep's predicate names no user at all, so
        // a UserId-leading index cannot serve it, and ADR 0038 decides deliberately that none
        // should — the table it scans is kept small by the sweep itself.
        jobs.HasIndex(j => new { j.UserId, j.CreatedAt });

        var rows = modelBuilder.Entity<ImportRow>();

        rows.HasKey(r => r.Id);
        rows.Property(r => r.SourceRef).HasMaxLength(64);
        rows.Property(r => r.Title).HasMaxLength(512);
        rows.Property(r => r.MatchKind).HasMaxLength(16);
        rows.Property(r => r.Decision).HasMaxLength(16);

        // jsonb for the reason CachedGame.Payload is: it is a document rather than a set of
        // columns, and PostgreSQL validates what is written to it.
        rows.Property(r => r.Payload).HasColumnType("jsonb");

        // Left to Npgsql's native integer[] rather than given jsonb like the payload beside it:
        // this is a list of ids, not a document, and nothing has to parse it to read one.

        rows.HasOne(r => r.User)
            .WithMany()
            .HasForeignKey(r => r.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        rows.HasOne(r => r.Job)
            .WithMany()
            .HasForeignKey(r => new { r.ImportJobId, r.UserId })
            .HasPrincipalKey(j => new { j.Id, j.UserId })
            .OnDelete(DeleteBehavior.Cascade);

        // Reading one job's rows is every query this table gets. No second index on ImportJobId
        // alone: the composite foreign key above already gets one that serves as its prefix, which
        // is the same reason the playthroughs declare none.
        rows.HasIndex(r => new { r.ImportJobId, r.Title });
    }

    private static void ConfigureUserGameEvents(ModelBuilder modelBuilder)
    {
        var events = modelBuilder.Entity<UserGameEvent>();

        events.HasKey(e => e.Id);

        events.HasOne(e => e.User)
            .WithMany()
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // No foreign key to UserGameEntry on purpose — a removal is an event, so the log has to
        // survive the deletion of the entry it describes.
        events.HasOne(e => e.FromStatus)
            .WithMany()
            .HasForeignKey(e => e.FromStatusId)
            .OnDelete(DeleteBehavior.Restrict);

        events.HasOne(e => e.ToStatus)
            .WithMany()
            .HasForeignKey(e => e.ToStatusId)
            .OnDelete(DeleteBehavior.Restrict);

        // One index per question the log gets asked: a user's own activity, a game's activity
        // across all users, and site-wide counts of arrivals at a given status.
        events.HasIndex(e => new { e.UserId, e.OccurredAt });
        events.HasIndex(e => new { e.GameId, e.OccurredAt });
        events.HasIndex(e => new { e.ToStatusId, e.OccurredAt });
    }
}
