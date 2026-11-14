using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// A reader's report of something published: a review, or a profile's name, picture and bio (ADR 0076).
/// </summary>
/// <remarks>
/// Named the way the reader sees it, by the handle on the page and the game it is about, because nothing a
/// public page sends carries a review's id (ADR 0028 §7). A review is the one its author wrote of that game;
/// with no game it is the profile.
/// </remarks>
/// <param name="UserName">The author's handle, or the profile's. Any letter case, as the lookup ignores it.</param>
/// <param name="GameId">The game the review is about, or null to report the profile itself.</param>
/// <param name="Reason">One of <see cref="ReportReason"/>.</param>
/// <param name="Note">What the reader adds for the admin: plain text, optional.</param>
public record ReportInputDto(
    [Required][StringLength(UserNamePolicy.MaxLength)] string UserName,
    [Range(1, int.MaxValue)] int? GameId,
    [Required]
    [AllowedValues(
        ReportReason.Spam,
        ReportReason.Abuse,
        ReportReason.Impersonation,
        ReportReason.Illegal,
        ReportReason.Rights,
        ReportReason.Other)]
    string Reason,
    [StringLength(ContentReport.NoteMaxLength)] string? Note);

/// <summary>
/// What the admin page's moderation card shows: what readers reported, and what was hidden.
/// </summary>
/// <remarks>
/// Each list is a page from its start, oldest report first for the reports and newest first for the
/// hidden reviews, with its total beside it so the card can say how many more wait.
/// </remarks>
public record ModerationQueueDto(
    IReadOnlyList<ReportedReviewDto> Reviews,
    int ReviewsTotal,
    IReadOnlyList<ReportedProfileDto> Profiles,
    int ProfilesTotal,
    IReadOnlyList<HiddenReviewDto> Hidden,
    int HiddenTotal);

/// <summary>One reader's report, without the reader: the admin page never says who reported (ADR 0076 §2).</summary>
public record ReportDto(string Reason, string? Note, DateTimeOffset ReportedAt);

/// <summary>A review readers reported, as it reads now, with every open report of it.</summary>
/// <param name="ReviewId">What the admin's action names, so a rename between the report and it cannot move it.</param>
/// <param name="GameTitle">From the game cache, or null when it has nothing for the game.</param>
/// <param name="Published">
/// Whether a reader would see it now: public, on a public profile, and not hidden. False when its author
/// has withdrawn it since, which leaves the report nothing to act on.
/// </param>
public record ReportedReviewDto(
    int ReviewId,
    string UserName,
    string? DisplayName,
    int GameId,
    string? GameTitle,
    string Body,
    bool HasSpoilers,
    bool Published,
    IReadOnlyList<ReportDto> Reports);

/// <summary>A profile readers reported, with what its owner wrote about themselves now.</summary>
/// <param name="AccountId">What the admin's action names, for the reason <see cref="ReportedReviewDto.ReviewId"/> gives.</param>
/// <param name="Published">Whether the profile is public now.</param>
public record ReportedProfileDto(
    string AccountId,
    string UserName,
    string? DisplayName,
    string? AvatarUrl,
    string? Bio,
    bool Published,
    IReadOnlyList<ReportDto> Reports);

/// <summary>A review an admin hid, which an admin can show again.</summary>
public record HiddenReviewDto(
    int ReviewId,
    string UserName,
    int GameId,
    string? GameTitle,
    string Body,
    bool HasSpoilers,
    DateTimeOffset HiddenAt);

/// <summary>Which of a profile's three fields an admin clears. At least one.</summary>
public record ClearProfileDto(bool DisplayName, bool AvatarUrl, bool Bio) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!DisplayName && !AvatarUrl && !Bio)
            yield return new ValidationResult("Choose the name, the picture or the bio to clear.", [nameof(DisplayName)]);
    }
}
