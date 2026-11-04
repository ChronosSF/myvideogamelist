using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services.Releases;

/// <summary>A row of the related-games query, as <see cref="RelatedGames.Fold"/> reads it.</summary>
/// <param name="FirstReleaseDate">IGDB's <c>first_release_date</c>, in Unix seconds; null for a game with no date anywhere.</param>
public sealed record RelatedCandidate(CalendarGame Game, long? FirstReleaseDate);

/// <summary>
/// What the game page shows of the games IGDB connects to one game (#450, ADR 0084): the rest of its series
/// and its own remakes, remasters and ports as cards, and its editions as a line of links.
/// </summary>
/// <remarks>
/// <para>
/// The release spec's relations (§3.2) across every date rather than a window: the game, the games whose
/// <c>parent_game</c> or <c>version_parent</c> it is, and the games in its series. Never its franchises,
/// which the spec turned down as too broad, and never <c>similar_games</c>, which the page shows apart as
/// what it is, a recommendation.
/// </para>
/// <para>
/// Its rules (§3.3) as they apply to a page about one game rather than to a calendar of releases. A
/// cancelled or rumoured game is dropped (F4). DLC, expansions, episodes, seasons, mods, forks, packs and
/// updates are not cards: the page lists the game's own DLC and expansions in a rail of their own, and the
/// rest are not what a player would call another game in the series (F1, F2). An edition is the game it
/// is an edition of (F3), so it is never a card: the anchor's are listed beside the rail, and the rest's
/// are dropped with them. The Witcher 3's "Game of the Year Edition" and "Complete Edition" are bundles
/// with the game as their <c>version_parent</c>, so a bundle of the anchor's is an edition here too.
/// </para>
/// <para>
/// One rule of the page's own. An expanded game or a port of another game in the series is folded into
/// that game, because the series would otherwise show each of its games twice: on 2026-11-04 The Witcher's
/// series held "The Witcher: Enhanced Edition" and its "Director's Cut", and "The Witcher 2: Assassins of
/// Kings - Enhanced Edition", all three typed Expanded Game. One of the anchor's own, or of a game the
/// series does not hold, is a card. A remake or a remaster is always a card, being a game of its own:
/// "The Witcher Remake" beside The Witcher, "The Witcher 3: Wild Hunt Remastered" beside The Witcher 3.
/// </para>
/// </remarks>
public static class RelatedGames
{
    /// <summary>
    /// The most rows one query reads, IGDB's own ceiling. Super Mario, the biggest series seen on 2026-11-04,
    /// held 123 games; a series past this is cut short and says so in the log rather than paging.
    /// </summary>
    internal const int QueryLimit = 500;

    /// <summary>
    /// How far up a chain of editions the anchor is looked for, as the calendar looks (F3). The spec found one
    /// two deep on 2026-09-29: an edition of The Witcher 3's "Complete Edition", a bundle, which is an edition
    /// of the game.
    /// </summary>
    private const int MaxEditionDepth = 4;

    /// <summary>The game types shown as a card, and what each is to the page.</summary>
    private static readonly IReadOnlyDictionary<int, string> CardKinds = new Dictionary<int, string>
    {
        [IgdbGameTypes.MainGame] = "game",
        [IgdbGameTypes.StandaloneExpansion] = "standalone",
        [IgdbGameTypes.Remake] = "remake",
        [IgdbGameTypes.Remaster] = "remaster",
        [IgdbGameTypes.ExpandedGame] = "expanded",
        [IgdbGameTypes.Port] = "port",
    };

    /// <summary>
    /// One query for all three relations. The game itself comes back too, for its type and its
    /// <c>version_parent</c>, which say whether the page is about an edition.
    /// </summary>
    internal static string BuildQuery(int gameId, IReadOnlyCollection<int> seriesIds)
    {
        var relations = $"id = {gameId} | parent_game = {gameId} | version_parent = {gameId}";
        if (seriesIds.Count > 0)
            relations += $" | collections = ({string.Join(',', seriesIds.Distinct().Order())})";

        return "fields id,name,cover.image_id,game_type,parent_game,version_parent,game_status,first_release_date;\n"
            + $"where {relations};\n"
            + $"limit {QueryLimit};\n";
    }

    /// <summary>The cards and the editions, each in release order, with the game the page marks as its own.</summary>
    internal static RelatedGamesDto Fold(int gameId, IReadOnlyList<RelatedCandidate> rows)
    {
        var byId = new Dictionary<int, RelatedCandidate>();
        foreach (var row in rows) byId.TryAdd(row.Game.Id, row);
        var games = byId.ToDictionary(pair => pair.Key, pair => pair.Value.Game);

        // An edition's page marks the game it is an edition of, as the calendar shows an edition's release
        // as that game's.
        var anchor = games.TryGetValue(gameId, out var self) && IsEdition(self) ? EditionRoot(self, games) : gameId;

        var alive = byId.Values
            .Where(row => row.Game.GameStatus is not (IgdbGameStatuses.Cancelled or IgdbGameStatuses.Rumored))
            .ToList();

        var standing = alive.Where(row => StandsAlone(row.Game)).Select(row => row.Game.Id).ToHashSet();

        var cards = alive
            .Where(row => standing.Contains(row.Game.Id) || IsShownApart(row.Game, anchor, standing, games))
            .OrderBy(row => row.FirstReleaseDate ?? long.MaxValue)
            .ThenBy(row => row.Game.Id)
            .Select(row => ToDto(row, CardKinds[TypeOf(row.Game)]))
            .ToList();

        var editions = alive
            .Where(row => row.Game.Id != anchor && row.Game.Id != gameId && IsEdition(row.Game) && EditionRoot(row.Game, games) == anchor)
            .OrderBy(row => row.FirstReleaseDate ?? long.MaxValue)
            .ThenBy(row => row.Game.Id)
            .Select(row => ToDto(row, TypeOf(row.Game) == IgdbGameTypes.Bundle ? "bundle" : "edition"))
            .ToList();

        return new RelatedGamesDto(anchor, cards, editions);
    }

    private static int TypeOf(CalendarGame game) => game.GameType ?? IgdbGameTypes.MainGame;

    /// <summary>A main game or a bundle that names another game as the game it is a version of.</summary>
    private static bool IsEdition(CalendarGame game) =>
        game.VersionParentId is not null && TypeOf(game) is IgdbGameTypes.MainGame or IgdbGameTypes.Bundle;

    /// <summary>A card on its own account: a game that is not an edition, a standalone expansion, a remake, a remaster.</summary>
    private static bool StandsAlone(CalendarGame game) => TypeOf(game) switch
    {
        IgdbGameTypes.MainGame => game.VersionParentId is null,
        IgdbGameTypes.StandaloneExpansion or IgdbGameTypes.Remake or IgdbGameTypes.Remaster => true,
        _ => false,
    };

    /// <summary>
    /// An expanded game or a port that is a card of its own: the anchor's, or one that reaches no card. Its
    /// game is found up a chain of them, since one can expand another: "The Witcher: Enhanced Edition Director's
    /// Cut" is a child of "The Witcher: Enhanced Edition", which is The Witcher's.
    /// </summary>
    private static bool IsShownApart(
        CalendarGame game, int anchor, HashSet<int> standing, IReadOnlyDictionary<int, CalendarGame> games)
    {
        if (!IsRerelease(game)) return false;

        var node = game;
        for (var depth = 0; depth < MaxEditionDepth; depth++)
        {
            if ((node.ParentGameId ?? node.VersionParentId) is not int parentId || parentId == anchor) return true;
            if (standing.Contains(parentId)) return false;
            if (!games.TryGetValue(parentId, out var parent) || !IsRerelease(parent)) return true;
            node = parent;
        }

        return true;
    }

    private static bool IsRerelease(CalendarGame game) =>
        TypeOf(game) is IgdbGameTypes.ExpandedGame or IgdbGameTypes.Port;

    /// <summary>
    /// The game at the end of a chain of editions. The calendar's fold (<see cref="ConnectedReleases.Fold"/>)
    /// starts only from a main game, since a bundle is never a release there; here a bundle of the anchor's is
    /// an edition, so a chain may start from one as well. It passes through main games and bundles, and ends at
    /// anything else, or at a game the query did not bring back, whose id is still the answer.
    /// </summary>
    private static int EditionRoot(CalendarGame game, IReadOnlyDictionary<int, CalendarGame> games)
    {
        var node = game;
        for (var depth = 0; depth < MaxEditionDepth; depth++)
        {
            if (node.VersionParentId is not int parentId) return node.Id;
            if (!games.TryGetValue(parentId, out var parent)) return parentId;
            node = parent;
            if (TypeOf(parent) is not (IgdbGameTypes.MainGame or IgdbGameTypes.Bundle)) return parent.Id;
        }

        return node.Id;
    }

    private static RelatedGameDto ToDto(RelatedCandidate row, string kind) =>
        new(
            row.Game.Id,
            row.Game.Name,
            row.Game.CoverImageUrl,
            row.FirstReleaseDate is long seconds ? DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime.Year : null,
            kind);
}
