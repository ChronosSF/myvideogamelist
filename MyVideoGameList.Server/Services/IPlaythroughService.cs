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

    /// <summary>Removes one playthrough. False when there was none to remove.</summary>
    Task<bool> DeleteAsync(
        string userId, int gameId, int playthroughId, CancellationToken cancellationToken = default);

    /// <summary>
    /// How long MVGL members report a game taking, per tier, with the sample size behind each.
    /// </summary>
    /// <remarks>
    /// Public and unscoped — this is the one read here that is about everybody rather than about
    /// one user. Always three buckets, so the client never guards a missing tier.
    /// </remarks>
    Task<CommunityTimesDto> GetCommunityTimesAsync(int gameId, CancellationToken cancellationToken = default);
}
