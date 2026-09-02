using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Walks the EF Core model and asserts that every user-owned table is reachable from the user.
/// </summary>
/// <remarks>
/// <para>
/// From <c>docs/data-model-plan.md</c>: the way not to miss a table is not to be careful, it is to
/// make the omission fail a build. The plan says to write this with the <em>second</em> such table
/// rather than the twentieth; <c>UserWishlistItems</c> is the fifth, so it is overdue.
/// </para>
/// <para>
/// The plan's full version also asserts that each table is named in a data-export manifest. There
/// is no export yet, so this covers the half that exists today — account deletion — and the export
/// assertion joins it when there is an export to assert against.
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
    private static readonly Type[] SystemOwned = [typeof(ListStatus)];

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
    public void TheUserOwnedTables_AreTheOnesWeThinkTheyAre()
    {
        // A deliberate tripwire rather than a tautology: adding a user-owned table fails this and
        // forces whoever added it to look at deletion and export before moving on.
        //
        // Scoped to our own models. ASP.NET Identity's tables carry a UserId too, but the
        // framework owns their lifecycle — they are covered by the cascade assertion above, which
        // they pass, and they are not ours to put in an export manifest.
        using var db = NewDb();

        var userOwned = db.Model.GetEntityTypes()
            .Where(entity => entity.ClrType.Assembly == typeof(UserGameEntry).Assembly)
            .Where(entity => entity.FindProperty("UserId") is not null)
            .Select(entity => entity.ClrType.Name)
            .OrderBy(name => name)
            .ToList();

        Assert.Equal(
            [
                nameof(UserGameEntry),
                nameof(UserGameEvent),
                nameof(UserHiddenPlatform),
                nameof(UserListSortPreference),
                nameof(UserWishlistItem),
            ],
            userOwned);
    }
}
