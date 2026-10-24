using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Mvc;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The listing's <c>limit</c>, which the navbar's typeahead asks for. It must cut the page the
/// browse listing shows rather than ask IGDB a smaller question: that is what makes the dropdown's
/// games the first games of the page Enter goes to, and what lets the two share one cache entry.
/// </summary>
public class GamesControllerTests
{
    private const int PageSize = 20;

    private static GameDto Game(int id) =>
        new(id, $"Game {id}", null, null, null, null, null, null, null, null, null, null, null,
            Platforms: [], Genres: [], Developers: [], Publishers: [], Details: null);

    private static (GamesController Controller, IIgdbService Igdb) ControllerAnswering(
        int games, bool hasMore)
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesAsync(
                Arg.Any<int>(), Arg.Any<int>(), Arg.Any<string?>(), Arg.Any<GameBrowseQuery?>(),
                Arg.Any<CancellationToken>())
            .Returns(new PagedGamesResponse(Enumerable.Range(1, games).Select(Game).ToList(), hasMore));

        var controller = new GamesController(
            igdb, Substitute.For<IPlaythroughService>(), Substitute.For<IGameCommunityService>());
        return (controller, igdb);
    }

    private static PagedGamesResponse Body(ActionResult<PagedGamesResponse> result) =>
        Assert.IsType<PagedGamesResponse>(Assert.IsType<OkObjectResult>(result.Result).Value);

    [Fact]
    public async Task GetGames_WithASmallLimit_AsksForTheWholePageAndReturnsItsFirstGames()
    {
        var (controller, igdb) = ControllerAnswering(games: PageSize, hasMore: false);

        var body = Body(await controller.GetGames(CancellationToken.None, search: "zelda", limit: 6));

        // The service is asked exactly what the browse page's first page asks it, so the cache entry
        // is the one that page reads.
        await igdb.Received(1).GetGamesAsync(
            0, PageSize, "zelda", Arg.Is<GameBrowseQuery?>(b => b == GameBrowseQuery.Default),
            Arg.Any<CancellationToken>());
        Assert.Equal([1, 2, 3, 4, 5, 6], body.Items.Select(g => g.Id));
        // Fourteen games were left out, which is more even though the page itself was the last.
        Assert.True(body.HasMore);
    }

    [Fact]
    public async Task GetGames_WithALimitAboveWhatThePageHolds_ReturnsThePageAsItIs()
    {
        var (controller, _) = ControllerAnswering(games: 3, hasMore: false);

        var body = Body(await controller.GetGames(CancellationToken.None, search: "fez", limit: 6));

        Assert.Equal([1, 2, 3], body.Items.Select(g => g.Id));
        Assert.False(body.HasMore);
    }

    [Fact]
    public async Task GetGames_WithALimitEqualToWhatThePageHolds_KeepsThePagesOwnHasMore()
    {
        // Nothing was cut, so whether there is more is the page's to say, not the cut's.
        var (controller, _) = ControllerAnswering(games: 6, hasMore: false);

        var body = Body(await controller.GetGames(CancellationToken.None, search: "hades", limit: 6));

        Assert.Equal(6, body.Items.Count());
        Assert.False(body.HasMore);
    }

    [Fact]
    public async Task GetGames_WithNoLimit_ReturnsTheWholePage()
    {
        var (controller, _) = ControllerAnswering(games: PageSize, hasMore: true);

        var body = Body(await controller.GetGames(CancellationToken.None));

        Assert.Equal(PageSize, body.Items.Count());
        Assert.True(body.HasMore);
    }

    [Fact]
    public void GetGames_Limit_IsBoundedToOnePage()
    {
        // Model validation turns the range into a 400 before the action runs, so it is read off the
        // parameter rather than exercised: a limit of nought or past a page is refused, not served.
        var range = typeof(GamesController).GetMethod(nameof(GamesController.GetGames))!
            .GetParameters().Single(p => p.Name == "limit")
            .GetCustomAttribute<RangeAttribute>()!;

        Assert.Equal(1, range.Minimum);
        Assert.Equal(PageSize, range.Maximum);
    }
}
