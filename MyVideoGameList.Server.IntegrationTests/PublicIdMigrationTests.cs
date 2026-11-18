using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// The migration that adds the profile's public id, run over accounts that already exist, as it runs on
/// dev's (ADR 0096 §3). Every other test here migrates an empty database.
/// </summary>
public class PublicIdMigrationTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    /// <summary>The last migration before <see cref="AddsTheId"/>.</summary>
    private const string Before = "20261114192304_AddModeration";

    private const string AddsTheId = "20261115141402_AddProfilePublicId";

    [Fact]
    public async Task MigrateAsync_OverExistingAccounts_GivesEachAnIdOfItsOwn()
    {
        // Touched so the fixture's server is up; this test makes a database of its own on it.
        Assert.NotNull(api.ConnectionString);
        var connectionString = await PostgresServer.CreateDatabaseAsync($"publicid_{Guid.NewGuid():N}");

        await using (var db = Context(connectionString))
        {
            await db.GetService<IMigrator>().MigrateAsync(Before);
            Assert.Equal(AddsTheId, (await db.Database.GetPendingMigrationsAsync()).First());

            // Accounts as the revision before this one wrote them, with no such column to name.
            for (var i = 0; i < 50; i++)
            {
                var id = Guid.NewGuid().ToString();
                var name = $"existing_{i}";
                await db.Database.ExecuteSqlInterpolatedAsync($"""
                    INSERT INTO "AspNetUsers" ("Id", "UserName", "NormalizedUserName", "ListView", "EmailConfirmed",
                        "PhoneNumberConfirmed", "TwoFactorEnabled", "LockoutEnabled", "AccessFailedCount")
                    VALUES ({id}, {name}, {name.ToUpperInvariant()}, {ListViewModes.Tiles}, TRUE, FALSE, FALSE, TRUE, 0)
                    """);
            }
        }

        await using (var db = Context(connectionString))
        {
            await db.GetService<IMigrator>().MigrateAsync();

            var ids = await db.Users.AsNoTracking().Select(u => u.PublicId).ToListAsync();

            // A default evaluated once for the statement rather than once a row would give all fifty the
            // same id, and the unique index would have refused the migration before this line.
            Assert.Equal(50, ids.Count);
            Assert.Equal(50, ids.Distinct().Count());
            Assert.All(ids, id => Assert.True(PublicIdPolicy.IsWellFormed(id), id));
        }
    }

    private static ApplicationDbContext Context(string connectionString) =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>().UseNpgsql(connectionString).Options);
}
