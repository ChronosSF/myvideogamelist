using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Data;

/// <summary>
/// Stores user-owned data only. Game metadata is not modelled here: IGDB is the source of
/// truth, and <see cref="UserGameEntry.GameId"/> holds an IGDB id rather than a local key.
/// A local metadata cache is planned (see ROADMAP §5) but will be designed around IGDB ids
/// rather than the local catalog schema this context used to carry.
/// </summary>
/// <remarks>
/// <see cref="ListStatuses"/> and <see cref="PlaythroughTypes"/> are the exceptions to "user-owned
/// data only": both are small system-owned lookups seeded by a migration, and they are what the
/// other tables key against.
/// </remarks>
public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<ListStatus> ListStatuses { get; set; }
    public DbSet<PlaythroughType> PlaythroughTypes { get; set; }
    public DbSet<Review> Reviews { get; set; }
    public DbSet<UserGameEntry> UserGameEntries { get; set; }
    public DbSet<UserGameEvent> UserGameEvents { get; set; }
    public DbSet<UserGamePlaythrough> UserGamePlaythroughs { get; set; }
    public DbSet<UserHiddenPlatform> UserHiddenPlatforms { get; set; }
    public DbSet<UserListSortPreference> UserListSortPreferences { get; set; }
    public DbSet<UserWishlistItem> UserWishlistItems { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        ConfigureApplicationUsers(modelBuilder);
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

        // A score out of 10, enforced by the database as well as by the API — the column outlives
        // any one validation attribute.
        modelBuilder.Entity<UserGameEntry>()
            .ToTable(t => t.HasCheckConstraint(
                "CK_UserGameEntries_Score_Range", "\"Score\" IS NULL OR (\"Score\" >= 1 AND \"Score\" <= 10)"));

        // Sorting a list by "recently added" or "recently moved" is the default view, so both
        // sort keys are indexed per user.
        modelBuilder.Entity<UserGameEntry>().HasIndex(e => new { e.UserId, e.AddedAt });
        modelBuilder.Entity<UserGameEntry>().HasIndex(e => new { e.UserId, e.StatusChangedAt });

        ConfigureUserGameEvents(modelBuilder);
        ConfigureUserGamePlaythroughs(modelBuilder);
        ConfigureReviews(modelBuilder);

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
        // rather than here. So it selects the entries for that game and joins in on
        // UserGameEntryId. No index is declared for that here on purpose — the composite foreign
        // key above already gets one on (UserGameEntryId, UserId), which serves the join as a
        // leading-column prefix. A second index on UserGameEntryId alone would be pure duplication.
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
