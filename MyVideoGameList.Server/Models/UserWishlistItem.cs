namespace MyVideoGameList.Server.Models;

/// <summary>
/// A game the user wants. An axis of its own, orthogonal to the five status lists.
/// </summary>
/// <remarks>
/// <para>
/// Not a sixth <see cref="ListStatus"/>, because the five statuses are mutually exclusive — a game
/// holds exactly one — while wanting a game and playing it are not. Someone can be part way
/// through a series and wishlisting the sequel, and a status could not express both at once.
/// </para>
/// <para>
/// A wishlist change is <em>not</em> a status transition and records no <see cref="UserGameEvent"/>.
/// <see cref="AddedAt"/> is the entire history this axis keeps, which is deliberate: the event log
/// is typed and narrow so that every statistic derived from it can assume one shape. See
/// <c>docs/data-model-plan.md</c>, decision 7.
/// </para>
/// <para>
/// Independent of <see cref="UserGameEntry"/> as well: wishlisting a game is usually the first
/// thing a user does with it, long before there is a score or a status to record.
/// </para>
/// </remarks>
public class UserWishlistItem
{
    public required string UserId { get; set; }

    /// <summary>IGDB game ID.</summary>
    public int GameId { get; set; }

    /// <summary>When the game was wishlisted. Never updated — re-adding an existing item is a no-op.</summary>
    public DateTimeOffset AddedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
}
