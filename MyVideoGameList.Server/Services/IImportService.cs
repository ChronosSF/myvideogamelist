using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>
/// Raised when an upload is refused before anything is written — too big, too many rows, or not a
/// file any preset recognises. Answered as a 400 with the message, so the message is for a person.
/// </summary>
public sealed class ImportRejectedException(string message) : Exception(message);

/// <summary>
/// Importing somebody else's tracker export: upload, review, commit.
/// </summary>
/// <remarks>
/// <para>
/// Alongside <see cref="IListService"/> rather than inside it, because an import is a different
/// kind of write. It creates entries without recording events, which every other path in this
/// application is forbidden to do (ADR 0018, exempted by ADR 0026 and ADR 0037), and keeping that
/// exemption in one service is what stops it leaking into the ordinary one.
/// </para>
/// <para>
/// There is no background job and no queue. The spec expected one because it expected a matching
/// pass against IGDB; Grouvee carries the ids, so the upload is parse-and-persist with no network
/// call in it at all, and the review reads game metadata through <see cref="IGameCacheService"/>
/// exactly as the lists page does for the same number of games. If a preset that needs real
/// matching arrives, that is when to add the queue §S5 describes — not before.
/// </para>
/// </remarks>
public interface IImportService
{
    /// <summary>
    /// Parses an uploaded file and stores it as a job awaiting review. Writes nothing to the user's
    /// library.
    /// </summary>
    /// <exception cref="ImportRejectedException">The upload was refused; the message says why.</exception>
    Task<ImportJobDto> CreateJobAsync(
        string userId, string fileName, string content, CancellationToken cancellationToken = default);

    /// <summary>The user's jobs, newest first, so an unfinished one can be resumed (§C4).</summary>
    Task<IReadOnlyList<ImportJobDto>> GetJobsAsync(
        string userId, CancellationToken cancellationToken = default);

    /// <summary>One job and its rows, or null when the user has no such job.</summary>
    /// <remarks>
    /// Null for a job belonging to somebody else as well as for one that does not exist — the two
    /// are the same answer, so the endpoint cannot be used to ask whether an id is in use.
    /// </remarks>
    Task<ImportReviewDto?> GetReviewAsync(
        string userId, Guid jobId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records what the user decided about some rows. Returns false when there is no such job.
    /// </summary>
    Task<bool> SetDecisionsAsync(
        string userId, Guid jobId, ImportDecisionsDto decisions, CancellationToken cancellationToken = default);

    /// <summary>
    /// Writes every row marked <c>import</c> into the user's library, in one transaction, and
    /// closes the job.
    /// </summary>
    /// <returns>What was written and what was not, or null when there is no such pending job.</returns>
    Task<ImportResultDto?> CommitAsync(
        string userId, Guid jobId, CancellationToken cancellationToken = default);

    /// <summary>Abandons a pending job. Returns false when there is no such pending job.</summary>
    Task<bool> CancelAsync(string userId, Guid jobId, CancellationToken cancellationToken = default);
}
