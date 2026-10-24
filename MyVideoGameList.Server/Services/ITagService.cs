using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// A user's tags, and which of their games carry them. Every call is scoped to the account passed in,
/// in its own predicate; nothing here reads or writes another account's rows.
/// </summary>
public interface ITagService
{
    /// <summary>Every tag of the account, with how many games carry each, in name order.</summary>
    Task<IReadOnlyList<TagDto>> GetTagsAsync(string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Makes a tag with this name, or finds the one the account already has under it in any letter
    /// case — <see cref="TagWriteResult.Created"/> says which. Refused, with the sentence to show, for a
    /// name <c>TagNamePolicy</c> will not take or an account at its cap.
    /// </summary>
    Task<TagWriteResult> CreateAsync(string userId, string name, CancellationToken cancellationToken = default);

    /// <summary>
    /// Renames one of the account's tags, keeping every game it is on. Refused for a name another of its
    /// tags already has; a change of letter case alone is a rename. Missing for a tag that is not the
    /// account's, which is the same answer as one that does not exist.
    /// </summary>
    Task<TagWriteResult> RenameAsync(
        string userId, int tagId, string name, CancellationToken cancellationToken = default);

    /// <summary>Deletes one of the account's tags and takes it off every game. False when there was none.</summary>
    Task<bool> DeleteAsync(string userId, int tagId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Makes this exactly the set of tags the account's entry for the game carries. A non-empty set on a
    /// game with no entry creates one, with no status; an empty set on one creates nothing. Refused, and
    /// nothing written, when any id is not one of the account's tags or the set is over the cap. Records
    /// no event: a tag is not a status.
    /// </summary>
    Task<EntryTagsResult> SetEntryTagsAsync(
        string userId, int gameId, IReadOnlyCollection<int> tagIds, CancellationToken cancellationToken = default);
}

/// <summary>
/// What a write to one tag came to: the tag as it now stands, a refusal to show beside the name, or
/// nothing found.
/// </summary>
public sealed record TagWriteResult
{
    public TagDto? Tag { get; private init; }

    /// <summary>Whether this call made the tag, rather than finding it or changing one that was there.</summary>
    public bool Created { get; private init; }

    /// <summary>The sentence the owner reads, when the write was refused.</summary>
    public string? Problem { get; private init; }

    /// <summary>No such tag on this account — never a different answer for somebody else's.</summary>
    public bool Missing { get; private init; }

    public static TagWriteResult Saved(TagDto tag, bool created = false) => new() { Tag = tag, Created = created };

    public static TagWriteResult Refused(string problem) => new() { Problem = problem };

    public static TagWriteResult NotFound { get; } = new() { Missing = true };
}

/// <summary>What a write of one game's whole set of tags came to.</summary>
/// <param name="Problem">Null when the set was stored; otherwise the sentence to show beside the field.</param>
public sealed record EntryTagsResult(string? Problem)
{
    public static EntryTagsResult Saved { get; } = new((string?)null);

    public static EntryTagsResult Refused(string problem) => new(problem);
}
