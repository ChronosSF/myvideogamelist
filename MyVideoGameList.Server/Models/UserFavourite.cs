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
/// <para>
/// The one axis its owner can arrange: the showcase is made to be shown, so the order it is shown in is
/// theirs to choose (<see cref="IHandOrdered"/>, ADR 0054 and ADR 0064).
/// </para>
/// </remarks>
public class UserFavourite : IGameAxisItem, IHandOrdered
{
    public required string UserId { get; set; }

    /// <summary>IGDB game ID.</summary>
    public int GameId { get; set; }

    /// <summary>When the game was made a favourite. Never updated — re-adding an existing one is a no-op.</summary>
    public DateTimeOffset AddedAt { get; set; }

    /// <summary>
    /// Where the owner put this game in their showcase by hand, or null when they never placed it —
    /// sparse, not an index; see <see cref="IHandOrdered"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Placed favourites come first, by this number; the rest follow newest first, which is the order
    /// every favourite was shown in before there was a hand order, so somebody who never arranges theirs
    /// sees nothing change. A game made a favourite again after it was taken off arrives unplaced: the
    /// row it had is gone, and its place with it.
    /// </para>
    /// <para>
    /// Published as an order and never as a number: the public profile shows the favourites in this
    /// order, and no public read carries the position itself. It is exported with the favourite, as
    /// stored. Nothing statistical reads it.
    /// </para>
    /// </remarks>
    public int? Position { get; set; }

    public ApplicationUser User { get; set; } = null!;
}
