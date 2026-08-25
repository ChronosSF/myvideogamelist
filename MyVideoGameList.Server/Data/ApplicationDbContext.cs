using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Data;

/// <summary>
/// Stores user-owned data only. Game metadata is not modelled here: IGDB is the source of
/// truth, and <see cref="UserGameList.GameId"/> holds an IGDB id rather than a local key.
/// A local metadata cache is planned (see ROADMAP §5) but will be designed around IGDB ids
/// rather than the local catalog schema this context used to carry.
/// </summary>
/// <remarks>
/// <see cref="ListStatuses"/> is the one exception to "user-owned data only": it is a small
/// system-owned lookup seeded by the migration, and it is what every other table keys against.
/// </remarks>
public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<ListStatus> ListStatuses { get; set; }
    public DbSet<UserGameList> UserGameLists { get; set; }
    public DbSet<UserGameEvent> UserGameEvents { get; set; }
    public DbSet<UserHiddenPlatform> UserHiddenPlatforms { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        ConfigureListStatuses(modelBuilder);

        // UserGameList: composite PK on (UserId, GameId); cascade delete when user is deleted
        modelBuilder.Entity<UserGameList>().HasKey(ul => new { ul.UserId, ul.GameId });
        modelBuilder.Entity<UserGameList>()
            .HasOne(ul => ul.User)
            .WithMany()
            .HasForeignKey(ul => ul.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // Restrict, not cascade: statuses are seeded reference data and deleting one would take
        // every entry using it with it. Adding a status is fine; removing one should fail loudly.
        modelBuilder.Entity<UserGameList>()
            .HasOne(ul => ul.Status)
            .WithMany()
            .HasForeignKey(ul => ul.StatusId)
            .OnDelete(DeleteBehavior.Restrict);

        ConfigureUserGameEvents(modelBuilder);

        // UserHiddenPlatform: composite PK on (UserId, IgdbPlatformId); cascade delete when user is deleted
        modelBuilder.Entity<UserHiddenPlatform>().HasKey(hp => new { hp.UserId, hp.IgdbPlatformId });
        modelBuilder.Entity<UserHiddenPlatform>()
            .HasOne(hp => hp.User)
            .WithMany()
            .HasForeignKey(hp => hp.UserId)
            .OnDelete(DeleteBehavior.Cascade);
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

    private static void ConfigureUserGameEvents(ModelBuilder modelBuilder)
    {
        var events = modelBuilder.Entity<UserGameEvent>();

        events.HasKey(e => e.Id);

        events.HasOne(e => e.User)
            .WithMany()
            .HasForeignKey(e => e.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // No foreign key to UserGameList on purpose — a removal is an event, so the log has to
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
