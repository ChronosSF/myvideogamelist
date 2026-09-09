using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// What the user is recording about one time through a game.
/// </summary>
/// <remarks>
/// <para>
/// Everything is optional. A playthrough logged the day someone starts a game carries a platform
/// and a start date; the type and the hours arrive when it ends, if they ever do. Only typed
/// playthroughs carrying minutes feed the community median, so an incomplete row costs nothing.
/// </para>
/// <para>
/// Validated by attribute so <c>[ApiController]</c> returns the 400 itself, and the allowed type
/// keys come from <see cref="PlaythroughTypeKeys"/> rather than a second list of literals. The
/// attributes target the constructor <em>parameter</em>, not the generated property — a
/// <c>[property:]</c> target compiles and then throws at request time, as
/// <see cref="SetListEntryDto"/> explains at greater length.
/// </para>
/// <para>
/// The one rule an attribute cannot express — a finish that precedes its start — is
/// <see cref="Validate"/> below, still inside model validation, so it is a 400 rather than a
/// hand-rolled guard in the controller.
/// </para>
/// </remarks>
public record PlaythroughInputDto(
    [AllowedValues(
        null,
        PlaythroughTypeKeys.Rushed,
        PlaythroughTypeKeys.Normally,
        PlaythroughTypeKeys.Completionist)]
    string? Type,
    [Range(1, int.MaxValue)] int? PlatformId,
    [Range(1, 600000)] int? MinutesPlayed,
    DateOnly? StartedOn,
    DateOnly? FinishedOn,
    [MaxLength(2000)] string? Notes) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        // Mirrors CK_UserGamePlaythroughs_Dates_Order. Without this the constraint would still
        // hold, but as a 500 from the database rather than a message next to the date field.
        if (StartedOn is DateOnly started && FinishedOn is DateOnly finished && finished < started)
        {
            yield return new ValidationResult(
                "The finish date cannot be before the start date.",
                [nameof(FinishedOn)]);
        }
    }
}

/// <summary>
/// One recorded playthrough, as the client sees it.
/// </summary>
/// <remarks>
/// <see cref="PlatformId"/> is a bare IGDB id, deliberately: resolving it to a name would mean an
/// IGDB call on a read that must keep working when IGDB does not. The client resolves it from the
/// game it is already showing.
/// </remarks>
public record PlaythroughDto(
    int Id,
    string? Type,
    int? PlatformId,
    int? MinutesPlayed,
    DateOnly? StartedOn,
    DateOnly? FinishedOn,
    string? Notes,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// How long MVGL members report a game taking, in the same three tiers IGDB reports.
/// </summary>
/// <remarks>
/// Always all three buckets, in effort order, even when every one of them is empty — the client
/// never has to guard a missing tier, and "nobody has logged this yet" is a thing the row can say.
/// </remarks>
public record CommunityTimesDto(IReadOnlyList<CommunityTimeBucketDto> Buckets);

/// <summary>
/// One tier's figure, and the number of playthroughs behind it.
/// </summary>
/// <remarks>
/// <para>
/// The count travels with the median for the reason ADR 0016 gives about scores: an average over
/// two members is exactly as uninformative as a critic score from one review, and a bare number
/// reads as a measured fact. The display floor lives in the client, as
/// <c>MIN_CRITIC_REVIEWS</c> does — the API's job is to report the sample size faithfully and let
/// each caller set its own bar.
/// </para>
/// <para>
/// A median rather than a mean: self-reported playtime has a long idle-hours tail, and one person
/// who left the game running over a weekend should not move the number.
/// </para>
/// </remarks>
/// <param name="Samples">
/// Playthroughs with both a type and a recorded duration. Untyped or minute-less rows are counted
/// nowhere, because they would inflate a figure they cannot contribute to.
/// </param>
/// <param name="MedianMinutes">Null when nothing has been logged for this tier.</param>
public record CommunityTimeBucketDto(string Type, int Samples, int? MedianMinutes);
