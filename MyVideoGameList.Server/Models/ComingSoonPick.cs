namespace MyVideoGameList.Server.Models;

/// <summary>
/// A game the admin has pinned to the home page's Coming soon panel, or hidden from it (ADR 0071).
/// </summary>
/// <remarks>
/// <para>
/// The panel is IGDB's own count of follows and nothing else; these are the corrections to it. A pin brings
/// in a game the floor of follows would leave out, and puts it ahead of the rest; a hide takes out one that
/// should not be there. Neither carries a game past the panel's dates.
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
/// What a pick does to the Coming soon panel. Closed at the API and in the database, as
/// <see cref="CuratedEventKinds"/> is.
/// </summary>
public static class ComingSoonPickKinds
{
    /// <summary>Shown whatever its follows, ahead of the rest, while its date is in the window.</summary>
    public const string Pin = "pin";

    /// <summary>Never shown, whatever its follows.</summary>
    public const string Hide = "hide";
}
