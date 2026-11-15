using System.Security.Claims;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Holds a start over's division of the user-owned tables to the export manifest, so that a table
/// added later cannot be left out of the question of whether starting over empties it.
/// </summary>
/// <remarks>
/// The deletes themselves are set-based, which the in-memory provider cannot run. They are tested
/// against PostgreSQL in the integration suite, by <c>OwnershipCascadeTests</c> and
/// <c>StartOverFlowTests</c>. See <c>docs/decisions/0095-*</c>.
/// </remarks>
public class LibraryResetTests
{
    /// <summary>
    /// The tables <see cref="LibraryResetService"/> deletes from with a statement of its own. Every
    /// other cleared table has to go by PostgreSQL's cascade from one of these.
    /// </summary>
    private static readonly Type[] DeletedByAStatement =
        [typeof(UserGameEntry), typeof(UserWishlistItem), typeof(UserFavourite), typeof(UserGameEvent)];

    [Fact]
    public void ClearedAndKept_BetweenThem_NameEveryTableInTheExportManifest()
    {
        var classified = LibraryResetService.Cleared.Concat(LibraryResetService.Kept).Select(t => t.Name).Order();

        // The manifest is already held to the model in both directions by UserOwnedDataTests, so a new
        // user-owned table reaches this assertion as soon as it is exported.
        Assert.Equal(UserDataExporter.Manifest.Keys.Select(t => t.Name).Order(), classified);
    }

    [Fact]
    public void ClearedAndKept_NameNoTableTwice()
    {
        Assert.Empty(LibraryResetService.Cleared.Intersect(LibraryResetService.Kept));
    }

    [Fact]
    public void Cleared_EveryTableWithoutAStatementOfItsOwn_CascadesFromOneThatHasOne()
    {
        // A table named as cleared and deleted by nothing would be a promise the service does not
        // keep: its rows would outlive the start over without failing anything.
        using var db = new ApplicationDbContext(new DbContextOptionsBuilder<ApplicationDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString())
            .Options);

        Assert.All(DeletedByAStatement, type => Assert.Contains(type, LibraryResetService.Cleared));

        var orphaned = LibraryResetService.Cleared
            .Except(DeletedByAStatement)
            .Where(type => !db.Model.FindEntityType(type)!.GetForeignKeys().Any(fk =>
                fk.IsRequired
                && fk.DeleteBehavior == DeleteBehavior.Cascade
                && DeletedByAStatement.Contains(fk.PrincipalEntityType.ClrType)))
            .Select(type => type.Name);

        Assert.Empty(orphaned);
    }

    // ---------------------------------------------------------------------------------------
    // The endpoint: the password is the confirmation
    // ---------------------------------------------------------------------------------------

    private const string UserId = "alice-id";

    private static (UserController Controller, ILibraryResetService Reset) StartOverController(string correctPassword)
    {
        var account = new ApplicationUser { Id = UserId, UserName = "alice" };
        var users = Substitute.For<UserManager<ApplicationUser>>(
            Substitute.For<IUserStore<ApplicationUser>>(), null, null, null, null, null, null, null, null);
        users.GetUserAsync(Arg.Any<ClaimsPrincipal>()).Returns(account);
        users.CheckPasswordAsync(account, Arg.Any<string>())
            .Returns(call => call.ArgAt<string>(1) == correctPassword);

        var reset = Substitute.For<ILibraryResetService>();
        reset.StartOverAsync(UserId, Arg.Any<CancellationToken>()).Returns(new StartOverResultDto(3, 1, 1, 4, 0));

        var controller = new UserController(
            users, null!, null!, null!, null!, null!, reset, null!, null!, null!, null!, null!, null!,
            TimeProvider.System)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };

        return (controller, reset);
    }

    [Fact]
    public async Task StartOver_WithTheWrongPassword_IsA401AndEmptiesNothing()
    {
        // As for deleting the account (ADR 0024 §7): a cookie says the browser signed in once, not
        // that the account holder is at the keyboard now, and nothing this deletes comes back.
        var (controller, reset) = StartOverController(correctPassword: "right");

        var result = await controller.StartOver(new StartOverDto("wrong"), CancellationToken.None);

        Assert.IsType<UnauthorizedObjectResult>(result.Result);
        await reset.DidNotReceiveWithAnyArgs().StartOverAsync(default!, default);
    }

    [Fact]
    public async Task StartOver_WithThePassword_EmptiesTheSignedInAccountsLibraryAndSaysWhatWent()
    {
        var (controller, reset) = StartOverController(correctPassword: "right");

        var result = await controller.StartOver(new StartOverDto("right"), CancellationToken.None);

        var counts = Assert.IsType<StartOverResultDto>(Assert.IsType<OkObjectResult>(result.Result).Value);
        Assert.Equal(new StartOverResultDto(3, 1, 1, 4, 0), counts);
        await reset.Received(1).StartOverAsync(UserId, Arg.Any<CancellationToken>());
    }
}
