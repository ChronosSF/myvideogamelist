using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.Services;
using NSubstitute;
using NSubstitute.ExceptionExtensions;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The member reviews' 400 is for a cursor the service refuses, and for nothing else that happens to
/// be an <see cref="ArgumentException"/>.
/// </summary>
public class GamesControllerReviewsTests
{
    private readonly IGameCommunityService community = Substitute.For<IGameCommunityService>();

    /// <summary>
    /// The controller with no host behind it, but with the services <c>ValidationProblem</c> reads, so
    /// that it answers with the problem the app answers with rather than an improvised one with no
    /// status.
    /// </summary>
    private GamesController Controller() =>
        new(Substitute.For<IIgdbService>(), Substitute.For<IPlaythroughService>(), community)
        {
            ControllerContext = new ControllerContext
            {
                HttpContext = new DefaultHttpContext
                {
                    RequestServices = new ServiceCollection().AddLogging().AddMvcCore().Services.BuildServiceProvider(),
                },
            },
        };

    [Fact]
    public async Task GetReviews_CursorTheServiceRefuses_IsABadRequestBesideTheParameter()
    {
        community.GetReviewsAsync(7, "forged", Arg.Any<CancellationToken>())
            .ThrowsAsync(new ArgumentException("Not a cursor this list issued.", "after"));

        var result = await Controller().GetReviews(7, CancellationToken.None, after: "forged");

        var answer = Assert.IsType<ObjectResult>(result.Result, exactMatch: false);
        var problem = Assert.IsType<ValidationProblemDetails>(answer.Value);
        Assert.Equal(StatusCodes.Status400BadRequest, answer.StatusCode);
        Assert.Contains("after", problem.Errors.Keys);
    }

    [Fact]
    public async Task GetReviews_ArgumentExceptionNamingAnotherParameter_Propagates()
    {
        // From somewhere below the service: a fault, which the exception handler answers as a 500, and
        // never "That is not a page of this list". The cursor's refusal is the only one named after it.
        community.GetReviewsAsync(7, null, Arg.Any<CancellationToken>())
            .ThrowsAsync(new ArgumentException("Not a count this query takes.", "count"));

        await Assert.ThrowsAsync<ArgumentException>(() => Controller().GetReviews(7, CancellationToken.None));
    }
}
