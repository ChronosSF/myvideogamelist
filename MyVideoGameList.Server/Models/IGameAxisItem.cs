namespace MyVideoGameList.Server.Models;

/// <summary>
/// One game on a per-user axis that sits beside the five status lists rather than among them — the
/// wishlist and the favourites.
/// </summary>
/// <remarks>
/// <para>
/// An axis row is a membership and a timestamp and nothing else. It has no status, no score, writes
/// no <see cref="UserGameEvent"/>, and needs no <see cref="UserGameEntry"/>, because wanting a game
/// or loving one is not exclusive with whatever list it sits in (ADR 0022). <see cref="AddedAt"/> is
/// the axis's entire history.
/// </para>
/// <para>
/// The interface exists so that the idempotent add and remove, which have a race in them each, are
/// written once in <c>GameAxisStore</c> for every axis. ADR 0022 records a guard applied to one
/// provider and missed on the other, twice; an axis whose writes are the same code cannot drift.
/// </para>
/// </remarks>
public interface IGameAxisItem
{
    string UserId { get; }

    /// <summary>IGDB game ID.</summary>
    int GameId { get; }

    /// <summary>When the game joined the axis. Never updated — re-adding an existing item is a no-op.</summary>
    DateTimeOffset AddedAt { get; }
}
