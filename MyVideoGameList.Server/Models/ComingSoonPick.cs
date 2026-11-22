namespace MyVideoGameList.Server.Models;

/// <summary>
/// A game the admin has pinned to the home page's release panels, Coming soon and Just out, or hidden from
/// them (ADR 0071, 0104).
/// </summary>
/// <remarks>
/// <para>
/// Each panel is IGDB's own counts and nothing else; these are the corrections to them. A pin brings in a
/// game the counts would leave out, and puts it ahead of the rest: on Coming soon until the game is out, and
/// on Just out for the ninety days after, for as long as the pin is kept. A hide takes out one that should
/// not be there, from both. Neither carries a game past a panel's dates.
/// </para>
/// <para>
/// Reference data, entered on the admin page as <see cref="CuratedEvent"/> is, and it carries no
/// <c>UserId</c> for the same reason. Keyed by the IGDB id with no foreign key, as every game id here is
/// (ADR 0035): one row a game, so a game is pinned or hidden and never both.
/// </para>
/// </remarks>
public class ComingSoonPick
{
    public const int TitleMaxLength = 200;

    /// <summary>The IGDB id.</summary>
    public int GameId { get; set; }

    /// <summary>One of <see cref="ComingSoonPickKinds"/>.</summary>
    public required string Kind { get; set; }

    /// <summary>
    /// The game's name when it was picked, so that the admin page lists the picks without asking IGDB,
    /// and a hidden game is named even while it is on nobody's panel.
    /// </summary>
    public required string Title { get; set; }

    /// <summary>When it was pinned or hidden, or last changed from one to the other.</summary>
    public DateTimeOffset PickedAt { get; set; }
}

/// <summary>
/// What a pick does to the home page's release panels. Closed at the API and in the database, as
/// <see cref="CuratedEventKinds"/> is.
/// </summary>
public static class ComingSoonPickKinds
{
    /// <summary>Shown whatever its counts, ahead of the rest, while its date is in a panel's window.</summary>
    public const string Pin = "pin";

    /// <summary>Never shown, whatever its counts.</summary>
    public const string Hide = "hide";
}
