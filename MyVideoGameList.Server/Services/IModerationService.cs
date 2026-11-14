using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

/// <summary>What became of an admin's clear of a profile's fields.</summary>
public enum ProfileClear
{
    Cleared,

    /// <summary>No such account, or nobody has an open report of its profile.</summary>
    NotFound,

    /// <summary>The owner saved the account between the read and the clear; nothing was written.</summary>
    Conflict,
}

/// <summary>
/// An admin's side of moderation: what readers reported, and the two ways to withdraw what a member
/// published (ADR 0076 §3).
/// </summary>
public interface IModerationService
{
    Task<ModerationQueueDto> GetQueueAsync(CancellationToken cancellationToken = default);

    /// <summary>Hides a review from every reader but its author and answers its reports.</summary>
    /// <returns>
    /// False when there is no such review, or it is not hidden and nobody has an open report of it: an admin
    /// acts from a report (ADR 0076 §3).
    /// </returns>
    Task<bool> HideReviewAsync(int reviewId, CancellationToken cancellationToken = default);

    /// <summary>Shows a hidden review again, under whatever gates its author has set.</summary>
    /// <returns>False when there is no such review, or it is not hidden.</returns>
    Task<bool> ShowReviewAsync(int reviewId, CancellationToken cancellationToken = default);

    /// <summary>Deletes every open report of a review, changing nothing else.</summary>
    Task DismissReviewReportsAsync(int reviewId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Clears the chosen fields of a reported profile and answers the reports about it. Nothing is cleared of
    /// a profile nobody has an open report of.
    /// </summary>
    Task<ProfileClear> ClearProfileAsync(
        string accountId, ClearProfileDto fields, CancellationToken cancellationToken = default);

    /// <summary>Deletes every open report of a profile, changing nothing else.</summary>
    Task DismissProfileReportsAsync(string accountId, CancellationToken cancellationToken = default);
}
