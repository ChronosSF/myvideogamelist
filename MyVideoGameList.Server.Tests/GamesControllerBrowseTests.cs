using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Services;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What <c>GET /api/games</c> hands the service: the step after model validation, where a parameter
/// that binds and validates can still be left out of the browse. Every test of the query builder would
/// pass, and the listing would quietly ignore that filter under a page that shows it chosen.
/// </summary>
public class GamesControllerBrowseTests
{
    [Fact]
    public async Task GetGames_WithEveryParameter_PassesEachIntoTheBrowse()
    {
        var igdb = Substitute.For<IIgdbService>();
        igdb.GetGamesAsync(
                Arg.Any<int>(), Arg.Any<int>(), Arg.Any<string?>(), Arg.Any<GameBrowseQuery?>(),
                Arg.Any<CancellationToken>())
            .Returns(new PagedGamesResponse([], HasMore: false));

        var controller = new GamesController(
            igdb, Substitute.For<IPlaythroughService>(), Substitute.For<IGameCommunityService>());

        await controller.GetGames(
            CancellationToken.None, offset: 40, search: "halo", sort: GameSortKeys.Popular,
            platform: 6, genre: 12, esrb: EsrbRatingKeys.M, year: 2020, minScore: 80);

        // Compared as a record, so each value has to land in its own field, not merely somewhere.
        await igdb.Received(1).GetGamesAsync(
            40,
            20,
            "halo",
            new GameBrowseQuery(
                GameSortKeys.Popular, PlatformId: 6, GenreId: 12, Year: 2020, MinScore: 80, Esrb: EsrbRatingKeys.M),
            Arg.Any<CancellationToken>());
    }
}
