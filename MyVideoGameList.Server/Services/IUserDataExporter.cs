using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IUserDataExporter
{
    /// <summary>
    /// Everything one user has entered, as one document.
    /// </summary>
    /// <remarks>
    /// Returns a fully populated document for a user with no rows at all — empty sections rather
    /// than nulls or a 404, because "you have recorded nothing" is a state an export has to be able
    /// to express.
    /// </remarks>
    /// <param name="userId">
    /// The owner. Every query is filtered on it, which is what keeps one account's data out of
    /// another's download — there is no route value to fall back on and no unscoped read.
    /// </param>
    /// <exception cref="InvalidOperationException">
    /// There is no account row for <paramref name="userId"/>. Callers reach this endpoint
    /// authenticated, so that is a broken invariant rather than a request to answer.
    /// </exception>
    Task<UserDataExportDto> ExportAsync(string userId, CancellationToken cancellationToken);
}
