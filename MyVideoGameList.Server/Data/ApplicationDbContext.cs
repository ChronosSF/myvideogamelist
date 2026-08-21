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
public class ApplicationDbContext(DbContextOptions<ApplicationDbContext> options)
    : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<UserGameList> UserGameLists { get; set; }
    public DbSet<UserHiddenPlatform> UserHiddenPlatforms { get; set; }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // UserGameList: composite PK on (UserId, GameId); cascade delete when user is deleted
        modelBuilder.Entity<UserGameList>().HasKey(ul => new { ul.UserId, ul.GameId });
        modelBuilder.Entity<UserGameList>()
            .HasOne(ul => ul.User)
            .WithMany()
            .HasForeignKey(ul => ul.UserId)
            .OnDelete(DeleteBehavior.Cascade);

        // UserHiddenPlatform: composite PK on (UserId, IgdbPlatformId); cascade delete when user is deleted
        modelBuilder.Entity<UserHiddenPlatform>().HasKey(hp => new { hp.UserId, hp.IgdbPlatformId });
        modelBuilder.Entity<UserHiddenPlatform>()
            .HasOne(hp => hp.User)
            .WithMany()
            .HasForeignKey(hp => hp.UserId)
            .OnDelete(DeleteBehavior.Cascade);
    }
}
