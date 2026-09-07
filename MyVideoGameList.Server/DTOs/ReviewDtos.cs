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
