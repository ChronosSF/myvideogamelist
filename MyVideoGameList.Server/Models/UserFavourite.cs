namespace MyVideoGameList.Server.Models;

/// <summary>
/// A game the user counts among their favourites. An axis of its own, like the wishlist.
/// </summary>
/// <remarks>
/// <para>
/// Independent of the status lists, of the wishlist and of <see cref="UserGameEntry"/>: a favourite
/// can be a game finished ten years ago that was never tracked here, or one still in Playing. So there
/// is no foreign key to the entry, exactly as there is none from <see cref="UserWishlistItem"/>.
/// </para>
/// <para>
/// Not a score either. A favourite is a statement about which games somebody would put in front of
/// other people, where a score is a judgement on a scale, and a game can be a favourite at 7/10.
/// It is shown with a rosette, never with a star, because stars mean the user's own score and nothing
/// else (ADR 0021).
/// </para>
/// <para>
/// Records no <see cref="UserGameEvent"/>; <see cref="AddedAt"/> is the whole history. See
/// <c>docs/decisions/0029-favourites-are-an-axis-and-a-showcase.md</c>.
/// </para>
/// </remarks>
public class UserFavourite : IGameAxisItem
{
    public required string UserId { get; set; }

    /// <summary>IGDB game ID.</summary>
    public int GameId { get; set; }

    /// <summary>When the game was made a favourite. Never updated — re-adding an existing one is a no-op.</summary>
    public DateTimeOffset AddedAt { get; set; }

    public ApplicationUser User { get; set; } = null!;
}
