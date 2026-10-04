namespace MyVideoGameList.Server.Models;

/// <summary>
/// The start of a name that makes an IGDB event a showcase worth a place on the calendar —
/// "Nintendo Direct", "State of Play".
/// </summary>
/// <remarks>
/// <para>
/// IGDB records a year's events faithfully — 184 in the year to September 2026 — and most of them are
/// small shows around the big ones, so an event is shown only when its name starts with one of these
/// (spec §5, E1). A prefix rather than a substring: "Day of the Devs: Summer Game Fest Digital
/// Showcase" is a satellite of Summer Game Fest, and does not start with it.
/// </para>
/// <para>
/// A table rather than a constant, so that a new show is added on the admin page rather than by a
/// pull request and a deploy. It is reference data, and carries no <c>UserId</c> for the reason
/// <see cref="CuratedEvent"/> gives.
/// </para>
/// </remarks>
public class ShowcaseName
{
    public const int PrefixMaxLength = 100;

    public int Id { get; set; }

    /// <summary>Compared with the start of an event's name, ignoring case. Kept as the admin typed it.</summary>
    public required string Prefix { get; set; }

    /// <summary>
    /// <see cref="Prefix"/> in upper case, and the column the unique index is on.
    /// </summary>
    /// <remarks>
    /// A name is on the list once in any letter case, because the match against an event's name
    /// ignores case. An index over <see cref="Prefix"/> itself held only the spelling, so two requests
    /// adding "Nintendo Direct" and "nintendo direct" at once could both pass the service's check and
    /// both get in — which review on #167 caught. Identity keeps a username unique the same way, over
    /// <c>NormalizedUserName</c>.
    /// </remarks>
    public required string NormalizedPrefix { get; set; }

    /// <summary>The one normalisation, so that the check and the index cannot disagree about a name.</summary>
    public static string Normalise(string prefix) => prefix.ToUpperInvariant();
}
