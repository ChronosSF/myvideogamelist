using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One of the signed-in user's tags, and how many of their games carry it.
/// </summary>
/// <remarks>
/// The owner's alone, like everything about a tag: only <c>/api/tags</c> answers with one, and that
/// needs the owner's cookie. A list row carries the ids of its tags and nothing else, so a rename is
/// one row here and nothing anywhere else changes (ADR 0065).
/// </remarks>
/// <param name="Count">
/// Games with an entry carrying the tag, whether or not they are in a list — a game taken out of every
/// list keeps its tags, as it keeps its score (ADR 0019).
/// </param>
public record TagDto(int Id, string Name, int Count);

/// <summary>
/// A name for a new tag, or a new name for one that exists. Normalised by <see cref="TagNamePolicy"/>
/// before it is stored, and refused beside the field when it cannot be.
/// </summary>
public record TagNameDto([Required] [ValidTagName] string Name);

/// <summary>
/// Every tag one game should carry, replacing whatever it carried — the whole set, so that one change on
/// the client is one request and its undo is that game's set as it was.
/// </summary>
/// <remarks>
/// An empty list takes every tag off. Ids that are not the caller's own tags are refused rather than
/// dropped: dropping them would answer 204 for a set the server did not store, and the client would go
/// on showing it. A tag named twice is carried once.
/// </remarks>
public record SetEntryTagsDto(
    [Required]
    [MaxLength(TagNamePolicy.MaxTagsPerEntry, ErrorMessage = "A game can carry at most {1} tags.")]
    IReadOnlyList<int> TagIds);
