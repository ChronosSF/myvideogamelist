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

    /// <summary>Compared with the start of an event's name, ignoring case.</summary>
    public required string Prefix { get; set; }
}
