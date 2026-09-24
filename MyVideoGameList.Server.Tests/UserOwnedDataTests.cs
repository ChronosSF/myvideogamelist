using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Walks the EF Core model and asserts that every user-owned table is both deleted with its user
/// and carried in their data export.
/// </summary>
/// <remarks>
/// <para>
/// From <c>docs/data-model-plan.md</c>: the way not to miss a table is not to be careful, it is to
/// make the omission fail a build. The plan says to write this with the <em>second</em> such table
/// rather than the twentieth; <c>UserWishlistItems</c> is the fifth, so it is overdue.
/// </para>
/// <para>
/// Both halves now exist. Deletion is asserted against the model — an entity carrying a
/// <c>UserId</c> must have a cascading foreign key from <c>AspNetUsers</c> tied to that column.
/// Export is asserted against <see cref="UserDataExporter.Manifest"/>, in both directions, so an
/// unregistered new table and a stale registration for a removed one each fail. The inventory
/// tripwire below fails the moment a sixth user-owned table appears at all.
/// </para>
/// <para>
/// What is deliberately <em>not</em> asserted here is a deletion actually cascading. These tests run
/// on the EF in-memory provider, which cascades only to rows the context happens to be tracking, so
/// such a test would pass or fail for reasons that have nothing to do with PostgreSQL. The cascade
/// is established by the model assertion below plus the <c>ON DELETE CASCADE</c> the migrations
/// emit from it. See <c>docs/decisions/0024-the-ownership-contract.md</c>.
/// </para>
/// </remarks>
public class UserOwnedDataTests
{
    private static ApplicationDbContext NewDb() =>
        new(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

    /// <summary>
    /// System-owned lookups. Everything else carrying a <c>UserId</c> is somebody's data and has
    /// to disappear with them.
    /// </summary>
    private static readonly Type[] SystemOwned = [typeof(ListStatus), typeof(PlaythroughType)];

    /// <summary>
    /// Our own user-owned entity types, which is what both halves of the contract are about.
    /// </summary>
    /// <remarks>
    /// Scoped to our own assembly. ASP.NET Identity's tables carry a <c>UserId</c> too, but the
    /// framework owns their lifecycle — they are covered by the cascade assertion, which they pass,
    /// and they are not ours to put in an export manifest.
    /// </remarks>
    private static List<Type> OurUserOwnedEntities(ApplicationDbContext db) =>
        db.Model.GetEntityTypes()
            .Where(entity => entity.ClrType.Assembly == typeof(UserGameEntry).Assembly)
            .Where(entity => entity.FindProperty("UserId") is not null)
            .Select(entity => entity.ClrType)
            .ToList();

    [Fact]
    public void EveryUserOwnedTable_IsDeletedWithItsUser()
    {
        using var db = NewDb();

        var missing = db.Model.GetEntityTypes()
            .Where(entity => !SystemOwned.Contains(entity.ClrType))
            .Where(entity => entity.FindProperty("UserId") is not null)
            .Where(entity => !CascadesFromItsUserIdColumn(entity))
            .Select(entity => entity.ClrType.Name)
            .ToList();

        Assert.Empty(missing);
    }

    /// <summary>
    /// Whether the entity is deleted with its user <em>through the <c>UserId</c> column</em>.
    /// </summary>
    /// <remarks>
    /// The property has to be tied to the foreign key, not merely present alongside one. An
    /// entity carrying an orphaned <c>UserId</c> plus an unrelated cascading <c>OwnerId</c> would
    /// otherwise satisfy the guard while leaving rows behind on account deletion, which is the one
    /// thing it exists to prevent.
    /// </remarks>
    private static bool CascadesFromItsUserIdColumn(IEntityType entity)
    {
        var userId = entity.FindProperty("UserId")!;

        return entity.GetForeignKeys().Any(fk =>
            fk.PrincipalEntityType.ClrType == typeof(ApplicationUser)
            && fk.DeleteBehavior == DeleteBehavior.Cascade
            && fk.Properties.Contains(userId));
    }

    [Fact]
    public void EveryUserOwnedChild_IsDeletedWithItsParent()
    {
        // The guard above answers "does this vanish when its owner does", which every child passes
        // through its own UserId. It says nothing about the other edge: a playthrough reaching its
        // entry, a row reaching its import job. Those foreign keys have a principal that is not
        // ApplicationUser, so CascadesFromItsUserIdColumn cannot see them.
        //
        // That gap has a caller. ImportRetentionService deletes jobs with a raw DELETE and never
        // mentions ImportRows, on the stated grounds that the foreign key carries them; weaken it
        // to Restrict — a plausible edit for a soft delete or an audit trail — and every other test
        // here still passes while the hourly sweep starts failing with a 23503 and swallowing it
        // into the log for ever. The same is true of an entry's playthroughs and reviews, where
        // the failure would reach a user deleting a game instead.
        using var db = NewDb();

        var missing = db.Model.GetEntityTypes()
            .Where(Ours)
            .SelectMany(entity => entity.GetForeignKeys())
            // A parent of ours that is itself somebody's data. Excludes AspNetUsers, which the
            // guard above owns, and the system lookups, which must *not* cascade.
            .Where(fk => Ours(fk.PrincipalEntityType) && fk.PrincipalEntityType.FindProperty("UserId") is not null)
            // Required, so the child cannot exist without the parent and the database must not be
            // able to leave it orphaned. An *optional* pointer to a sibling is a different thing
            // and is deliberately not cascaded: a review names the playthrough it is about, and
            // deleting the record of one run must not take the prose with it. That one is SetNull,
            // and this clause is what keeps it out rather than a name in an exclusion list.
            .Where(fk => fk.IsRequired)
            .Where(fk => fk.DeleteBehavior != DeleteBehavior.Cascade)
            .Select(fk => $"{fk.DeclaringEntityType.ClrType.Name} -> {fk.PrincipalEntityType.ClrType.Name}")
            .ToList();

        Assert.Empty(missing);
    }

    /// <summary>Ours rather than Identity's, by the assembly the type comes from.</summary>
    private static bool Ours(IEntityType entity) =>
        entity.ClrType.Assembly == typeof(UserGameEntry).Assembly;

    [Fact]
    public void EveryUserOwnedTable_IsNamedInTheExportManifest()
    {
        // The half the data-model plan asked for and could not have before there was an export to
        // assert against. A user-owned table that nothing exports is data the user cannot take with
        // them, which is a compliance defect that would otherwise surface at the worst moment.
        using var db = NewDb();

        var unexported = OurUserOwnedEntities(db)
            .Except(UserDataExporter.Manifest.Keys)
            .Select(type => type.Name)
            .ToList();

        Assert.Empty(unexported);
    }

    [Fact]
    public void EveryExportManifestEntry_IsAUserOwnedTable()
    {
        // The other direction, so a registration left behind by a removed or renamed table fails
        // too. Without it the manifest could drift into naming things the model no longer has,
        // which would make the assertion above pass for the wrong reason.
        using var db = NewDb();

        var stale = UserDataExporter.Manifest.Keys
            .Except(OurUserOwnedEntities(db))
            .Select(type => type.Name)
            .ToList();

        Assert.Empty(stale);
    }

    [Fact]
    public void TheUserOwnedTables_AreTheOnesWeThinkTheyAre()
    {
        // A deliberate tripwire rather than a tautology: adding a user-owned table fails this and
        // forces whoever added it to look at deletion and export before moving on.
        using var db = NewDb();

        var userOwned = OurUserOwnedEntities(db)
            .Select(type => type.Name)
            .OrderBy(name => name)
            .ToList();

        Assert.Equal(
            [
                nameof(ImportJob),
                nameof(ImportRow),
                nameof(Review),
                nameof(UserFavourite),
                nameof(UserGameEntry),
                nameof(UserGameEvent),
                nameof(UserGamePlaythrough),
                nameof(UserHiddenPlatform),
                nameof(UserListSetting),
                nameof(UserListSortPreference),
                nameof(UserWishlistItem),
            ],
            userOwned);
    }
}
