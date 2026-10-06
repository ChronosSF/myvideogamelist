using System.ComponentModel.DataAnnotations;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// The window <c>GET /api/user/releases</c> is asked about (spec §8.2, B1).
/// </summary>
/// <param name="To">Exclusive: a two-week line from the 1st asks up to the 15th.</param>
/// <param name="Precision">
/// <c>day</c>, the default, for only the releases known to the day — all the two-week line shows (L2) —
/// or <c>any</c> for the month, quarter and year ones as well, which the calendar puts in bands (D2).
/// </param>
public record ReleaseWindowQuery(
    [Required] DateOnly? From,
    [Required] DateOnly? To,
    [AllowedValues(null, ReleaseWindowQuery.DayPrecision, ReleaseWindowQuery.AnyPrecision)] string? Precision) : IValidatableObject
{
    public const string DayPrecision = "day";
    public const string AnyPrecision = "any";

    /// <summary>
    /// A year of the calendar and the month it opens on. The cap is what keeps one request from asking
    /// IGDB about a decade of somebody's library.
    /// </summary>
    public const int MaxDays = 400;

    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (From is not { } from || To is not { } to) yield break;

        if (to <= from)
            yield return new ValidationResult("The window has to end after it starts.", [nameof(To)]);
        else if (to.DayNumber - from.DayNumber > MaxDays)
            yield return new ValidationResult($"The window can be at most {MaxDays} days long.", [nameof(To)]);
    }
}

/// <summary>
/// One thing the line or the calendar draws: a release, or several in the same period that belong
/// together (F6).
/// </summary>
/// <param name="Precision"><c>day</c>, <c>month</c>, <c>quarter</c> or <c>year</c> (spec §4).</param>
/// <param name="Starts">The day, or the first day of the month, quarter or year.</param>
/// <param name="GroupName">What the releases have in common when there are several — "Kingdom Hearts".</param>
public record ReleaseEntryDto(
    string Precision,
    DateOnly Starts,
    string? GroupName,
    IReadOnlyList<ConnectedReleaseDto> Releases);

/// <param name="Kind">
/// What the release is, from IGDB's game type: <c>game</c>, <c>dlc</c>, <c>expansion</c>,
/// <c>standalone_expansion</c>, <c>episode</c>, <c>season</c>, <c>remake</c>, <c>remaster</c>,
/// <c>expanded_game</c> or <c>port</c>.
/// </param>
/// <param name="Platforms">What it arrives on in this period. Empty when IGDB did not say.</param>
public record ConnectedReleaseDto(
    int GameId,
    string Title,
    string? CoverImageUrl,
    string Kind,
    IReadOnlyList<PlatformDto> Platforms,
    bool EarlyAccess,
    ReleaseReasonDto Reason);

/// <summary>
/// Why a release is on somebody's calendar (spec §3.4), as data: the client says it in words, "Expansion
/// for Elden Ring, a favourite".
/// </summary>
/// <param name="Relation"><c>itself</c>, <c>child</c> or <c>series</c> — R1, R2 and R3.</param>
/// <param name="GameId">The game in the user's set that brought it in.</param>
/// <param name="Title">That game's title; null only for a game IGDB no longer answers for.</param>
/// <param name="Membership"><c>favourite</c>, <c>wishlist</c> or <c>list</c>.</param>
/// <param name="List">The list's status key, when the membership is a list.</param>
/// <param name="Series">The series they share, when the relation is <c>series</c>.</param>
public record ReleaseReasonDto(
    string Relation,
    int GameId,
    string? Title,
    string Membership,
    string? List,
    string? Series);
