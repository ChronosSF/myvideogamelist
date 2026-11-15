using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Empties an account's library and keeps the account: "Start over" on the settings page.
/// </summary>
/// <remarks>
/// For somebody whose import went wrong, who would otherwise have only one way back to an empty
/// library: deleting their account. See <c>docs/decisions/0095-*</c>.
/// </remarks>
public interface ILibraryResetService
{
    /// <summary>
    /// Deletes every game the account holds, with everything recorded about each, its wishlist, its
    /// favourites and its event log, in one transaction, and selects again the rows of its pending
    /// imports that were skipped only because their game was in the library. The caller has already
    /// checked the password.
    /// </summary>
    Task<StartOverResultDto> StartOverAsync(string userId, CancellationToken cancellationToken);
}
