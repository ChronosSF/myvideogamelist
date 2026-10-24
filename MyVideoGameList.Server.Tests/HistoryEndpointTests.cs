using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What <c>GET /api/user/history</c> adds to the service behind it: the 400 a refused cursor
/// becomes, and the attributes that keep it out of every cache and check a cursor's shape.
/// </summary>
/// <remarks>
/// The client's "Start again" rests on the first of these. A refused cursor has to come back as a
/// 400 with its sentence beside <c>after</c>, or the page offers to retry a request that will fail
/// the same way every time.
/// </remarks>
public class HistoryEndpointTests
{
    private const string UserId = "user-1";

    /// <summary>The sentence a refused cursor carries, whichever check refused it.</summary>
    private const string NotAPage = "That is not a page of this history. Start again from the first.";

    /// <summary>
    /// The controller with only what this action reads: the signed-in id and the history. The other
    /// collaborators belong to other actions and are never touched here.
    /// </summary>
    private static UserController Controller(IHistoryService history)
    {
        var users = Substitute.For<UserManager<ApplicationUser>>(
            Substitute.For<IUserStore<ApplicationUser>>(), null, null, null, null, null, null, null, null);
        users.GetUserId(Arg.Any<System.Security.Claims.ClaimsPrincipal>()).Returns(UserId);

        // MVC's own problem-details factory, so the 400 is the one the application sends rather than
        // the bare fallback ControllerBase improvises when it has none.
        var services = new ServiceCollection().AddLogging().AddMvcCore().Services.BuildServiceProvider();

        return new UserController(
            users, null!, null!, Substitute.For<IStatsService>(), history, null!, null!, null!, null!, null!,
            null!, TimeProvider.System)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext { RequestServices = services }
            }
        };
    }

    [Fact]
    public async Task GetHistory_Page_IsReturnedForTheSignedInAccount()
    {
        var history = Substitute.For<IHistoryService>();
        var page = new HistoryPageDto([], Next: null, ImportedStatuses: 0, UndatedScores: 0);
        history.GetHistoryAsync(UserId, null, Arg.Any<CancellationToken>()).Returns(page);

        var result = await Controller(history).GetHistory(CancellationToken.None);

        Assert.Same(page, Assert.IsType<OkObjectResult>(result.Result).Value);
    }

    [Fact]
    public async Task GetHistory_RefusedCursor_IsA400BesideAfter()
    {
        var history = Substitute.For<IHistoryService>();
        history.GetHistoryAsync(UserId, "stale", Arg.Any<CancellationToken>())
            .ThrowsAsync(new ArgumentException("Not a cursor this history issued.", "after"));

        var result = await Controller(history).GetHistory(CancellationToken.None, "stale");

        var refused = Assert.IsType<BadRequestObjectResult>(result.Result);
        var problem = Assert.IsType<ValidationProblemDetails>(refused.Value);
        Assert.Equal(400, problem.Status);
        Assert.Equal([NotAPage], problem.Errors["after"]);
    }

    [Fact]
    public async Task GetHistory_OtherArgumentException_IsNotTakenForARefusedCursor()
    {
        // An ArgumentOutOfRangeException is an ArgumentException. Caught as one, it would tell the
        // reader their page was the problem — on the first page too, where retrying cannot help.
        var history = Substitute.For<IHistoryService>();
        history.GetHistoryAsync(UserId, null, Arg.Any<CancellationToken>())
            .ThrowsAsync(new ArgumentOutOfRangeException("kind"));

        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(
            () => Controller(history).GetHistory(CancellationToken.None));
    }

    [Fact]
    public void GetHistory_IsNoStore_AndChecksTheCursorsShapeInTheSameWords()
    {
        // The attributes are the whole of this, so they are read rather than exercised: no-store,
        // because the answer differs per account; and the shape check, which refuses before a
        // decryption is spent and has to say what the key ring's refusal says.
        var action = typeof(UserController).GetMethod(nameof(UserController.GetHistory))!;

        var cache = action.GetCustomAttribute<ResponseCacheAttribute>();
        Assert.NotNull(cache);
        Assert.True(cache.NoStore);
        Assert.Equal(ResponseCacheLocation.None, cache.Location);

        var after = action.GetParameters().Single(p => p.Name == "after");
        var shape = after.GetCustomAttribute<RegularExpressionAttribute>();
        Assert.NotNull(shape);
        Assert.Equal(HistoryCursor.Pattern, shape.Pattern);
        Assert.Equal(NotAPage, shape.ErrorMessage);
    }
}
