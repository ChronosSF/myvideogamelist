using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>A reader's side of moderation: reporting what is published (ADR 0076 §1).</summary>
public interface IContentReportService
{
    /// <summary>
    /// Records the reader's report, or replaces the reason and note of the one they already made.
    /// </summary>
    /// <returns>
    /// False when nothing published answers to it — no such public profile, or no review of that game
    /// published on it — which is the same answer whatever the reason, as the public reads give.
    /// </returns>
    Task<bool> ReportAsync(string reporterId, ReportInputDto input, CancellationToken cancellationToken = default);
}
