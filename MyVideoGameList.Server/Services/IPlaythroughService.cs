using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Services;

public interface IPlaythroughService
{
    /// <summary>
    /// Everything the user has logged about playing one game, oldest first. Empty when they have
    /// logged nothing, which is not the same as the game being unknown.
    /// </summary>
    Task<IReadOnlyList<PlaythroughDto>> GetForGameAsync(
        string userId, int gameId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records one more time through the game, creating the entry if this is the first thing the
    /// user has recorded about it.
    /// </summary>
    /// <remarks>
    /// Writes no <c>UserGameEvent</c> and touches no status. A playthrough is not a transition —
    /// replaying a game already marked Finished adds a row and changes nothing else (ADR 0018).
    /// </remarks>
    /// <exception cref="ArgumentException">The type key is not one of the seeded types.</exception>
    Task<PlaythroughDto> AddAsync(
        string userId, int gameId, PlaythroughInputDto input, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces one playthrough's fields. Null when the user has no playthrough with that id for
    /// that game — which covers both "never existed" and "belongs to somebody else".
    /// </summary>
    /// <exception cref="ArgumentException">The type key is not one of the seeded types.</exception>
    Task<PlaythroughDto?> UpdateAsync(
        string userId,
        int gameId,
        int playthroughId,
        PlaythroughInputDto input,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Starts an untyped playthrough on the given day, as the reader's yes to the question a move to
    /// Playing asks — unless the game already has an unfinished one (ADR 0097).
    /// </summary>
    /// <remarks>
    /// Serialised per game, so two starts at once make one run. Creates the entry if there is none, as
    /// <see cref="AddAsync"/> does. Writes no event and touches no status.
    /// </remarks>
    Task<PlaythroughStep> StartAsync(
        string userId, int gameId, DateOnly startedOn, CancellationToken cancellationToken = default);

    /// <summary>
    /// Puts the given day on one playthrough as its finish date, as the reader's yes to the question a
    /// move to Finished asks — only while it is unfinished, and never before it started (ADR 0097).
    /// </summary>
    Task<PlaythroughStep> FinishAsync(
        string userId,
        int gameId,
        int playthroughId,
        DateOnly finishedOn,
        CancellationToken cancellationToken = default);

    /// <summary>Removes one playthrough. False when there was none to remove.</summary>
    Task<bool> DeleteAsync(
        string userId, int gameId, int playthroughId, CancellationToken cancellationToken = default);

    /// <summary>
    /// How long MVGL members report a game taking, per tier, with the sample size behind each.
    /// </summary>
    /// <remarks>
    /// Public and unscoped — this is the one read here that is about everybody rather than about
    /// one user. Always three buckets, so the client never guards a missing tier, and each one's
    /// median only from <see cref="Models.CommunityFloors.PlaythroughSamples"/> runs (ADR 0094).
    /// </remarks>
    Task<CommunityTimesDto> GetCommunityTimesAsync(int gameId, CancellationToken cancellationToken = default);
}

/// <summary>Why a start or a finish asked for from a move's question changed nothing (ADR 0097).</summary>
public enum PlaythroughStepRefusal
{
    /// <summary>A start, refused because the game has an unfinished playthrough already.</summary>
    AlreadyUnfinished,

    /// <summary>A finish of a playthrough the user no longer has, for that game.</summary>
    NotFound,

    /// <summary>A finish of a playthrough that has a finish date already.</summary>
    AlreadyFinished,

    /// <summary>A finish on a day before the playthrough started.</summary>
    StartsLater
}

/// <summary>
/// How a start or a finish ended: the playthrough as it was written, or why nothing was.
/// </summary>
/// <param name="Playthrough">The run started or finished; null when refused.</param>
/// <param name="Refusal">Why nothing was written; null when something was.</param>
public record PlaythroughStep(PlaythroughDto? Playthrough, PlaythroughStepRefusal? Refusal)
{
    public static PlaythroughStep Done(PlaythroughDto playthrough) => new(playthrough, null);

    public static PlaythroughStep Refused(PlaythroughStepRefusal refusal) => new(null, refusal);
}
