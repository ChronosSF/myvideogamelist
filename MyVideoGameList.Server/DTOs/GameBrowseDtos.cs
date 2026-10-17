namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// The orders the browse listing can be put in. Keys, because they are in URLs people share.
/// </summary>
/// <remarks>
/// Each order carries its own floor on what it lists, in <c>IgdbService.BuildQuery</c>, because each
/// needs a different one to mean anything. See
/// <c>docs/decisions/0032-each-browse-order-carries-its-own-floor.md</c>.
/// </remarks>
public static class GameSortKeys
{
    /// <summary>By critic score, among games with enough critics to rank. The default (ADR 0016).</summary>
    public const string Rating = "rating";

    /// <summary>By how many ratings IGDB holds for the game — critics' and players' together.</summary>
    public const string Popular = "popular";

    /// <summary>Most recently released first, among released games somebody has noticed.</summary>
    public const string Newest = "newest";

    /// <summary>A to Z, among games somebody has noticed.</summary>
    public const string Name = "name";
}

/// <summary>
/// The ESRB ratings the browse listing can be narrowed to, named as IGDB names them. Keys rather than
/// IGDB's ids, because they are in URLs people share and IGDB has renumbered its age ratings once
/// already; <c>IgdbService.EsrbRatings</c> holds the id each one stands for.
/// </summary>
/// <remarks>
/// Every rating the ESRB gives, youngest audience first. Not Rating Pending, which IGDB lists among
/// the ESRB's categories but which says that there is no rating yet: under the browse floors it holds
/// a handful of released games whose row was never updated.
/// </remarks>
public static class EsrbRatingKeys
{
    /// <summary>Early Childhood.</summary>
    public const string EC = "ec";

    /// <summary>Everyone.</summary>
    public const string E = "e";

    /// <summary>Everyone 10+.</summary>
    public const string E10 = "e10";

    /// <summary>Teen.</summary>
    public const string T = "t";

    /// <summary>Mature 17+.</summary>
    public const string M = "m";

    /// <summary>Adults Only 18+.</summary>
    public const string AO = "ao";
}

/// <summary>
/// What the browse listing is narrowed to and put in order by. Every filter is optional, and all of
/// them apply to a search as well as to the catalogue.
/// </summary>
/// <param name="Sort">One of <see cref="GameSortKeys"/>. Ignored by a search, which IGDB orders itself.</param>
/// <param name="PlatformId">An IGDB platform id.</param>
/// <param name="GenreId">An IGDB genre id.</param>
/// <param name="Year">A calendar year of first release, in UTC.</param>
/// <param name="MinScore">A floor on the critic score, out of 100.</param>
/// <param name="Esrb">
/// One of <see cref="EsrbRatingKeys"/>: the games whose ESRB rating is that one, which leaves out every
/// game IGDB holds no ESRB rating for.
/// </param>
public record GameBrowseQuery(
    string Sort = GameSortKeys.Rating,
    int? PlatformId = null,
    int? GenreId = null,
    int? Year = null,
    int? MinScore = null,
    string? Esrb = null)
{
    public static readonly GameBrowseQuery Default = new();
}
