using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// The user's own review of one game — at most one per game, hung off the entry.
/// </summary>
/// <remarks>
/// <para>
/// The score is deliberately <em>not</em> here. It lives on the entry, because a score with no
/// prose is the common case and must not require a review row to exist.
/// </para>
/// <para>
/// Defined ahead of the table it describes, so that <see cref="EntryDetailDto.Review"/> has its
/// shape from the first release of that endpoint and the client's type does not churn when the
/// review half ships. Until then the field is always null.
/// </para>
/// </remarks>
/// <param name="Visibility">
/// <c>public</c> or <c>private</c>. A string rather than a flag because a third value —
/// <c>friends</c> — is a plausible addition once following exists, and adding one to a string
/// column is additive where splitting a boolean is not.
/// </param>
/// <param name="PlaythroughId">
/// The playthrough the review is about, when the user said which. Optional: most reviews are
/// about the game rather than about one specific run through it.
/// </param>
public record ReviewDto(
    int Id,
    string Body,
    bool HasSpoilers,
    string Visibility,
    int? PlaythroughId,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

/// <summary>
/// A review being written or rewritten. One per game, so there is no create/update distinction —
/// the endpoint is a <c>PUT</c>.
/// </summary>
/// <remarks>
/// Validated by attribute so <c>[ApiController]</c> returns the 400 itself, with the allowed
/// visibilities coming from <see cref="ReviewVisibility"/> rather than a second list of literals.
/// The attributes target the constructor <em>parameter</em> — see <see cref="SetListEntryDto"/>
/// for why a <c>[property:]</c> target compiles and then throws at request time.
/// </remarks>
/// <param name="PlaythroughId">
/// Optional, and checked by the service to belong to this user and this game — an id from
/// somebody else's account is a 400 rather than a silently stored pointer.
/// </param>
public record ReviewInputDto(
    [Required]
    [MaxLength(10000)]
    string Body,
    bool HasSpoilers,
    [Required]
    [AllowedValues(ReviewVisibility.Public, ReviewVisibility.Private)]
    string Visibility,
    [Range(1, int.MaxValue)] int? PlaythroughId);
