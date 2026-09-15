using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// The outcome of saving a user's list names: the names as stored, or why each refused one was.
/// </summary>
/// <param name="Names">Status key to display name for renamed lists; null when nothing was saved.</param>
/// <param name="Errors">Status key to the sentence its owner reads. Empty on success.</param>
public record ListNamesResult(
    IReadOnlyDictionary<string, string>? Names,
    IReadOnlyDictionary<string, string> Errors)
{
    public bool Succeeded => Names is not null;
}

public interface IListNameService
{
    /// <summary>What the user calls each list they have renamed, keyed by status key.</summary>
    Task<IReadOnlyDictionary<string, string>> GetNamesAsync(
        string userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces every list name at once. Nothing is written unless every name passes, so a refused
    /// save leaves the old names exactly as they were.
    /// </summary>
    Task<ListNamesResult> ReplaceAsync(
        string userId, IReadOnlyList<ListNameInputDto> names, CancellationToken cancellationToken = default);
}
