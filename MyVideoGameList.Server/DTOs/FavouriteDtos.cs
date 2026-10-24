namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One of the user's favourite games, when they made it one, and where they put it in their
/// showcase.
/// </summary>
/// <remarks>
/// <para>
/// Its own record rather than a <see cref="WishlistItemDto"/>, although the two began with the same
/// fields: they are different axes, and a shared type invites code that treats wanting a game and
/// loving one as interchangeable — the reason the wishlist's own DTO is not a list entry either.
/// </para>
/// <para>
/// <paramref name="Position"/> is the sparse number the owner's client arranges the showcase by, or
/// null for a favourite never placed (ADR 0054). The owner's own read carries it; the public profile's
/// carries the order alone.
/// </para>
/// </remarks>
public record FavouriteDto(GameDto Game, DateTimeOffset AddedAt, int? Position);

/// <summary>
/// The answer to making a game a favourite: when it became one, which for a game that already was
/// one is the original time rather than now, and where it stands in the showcase.
/// </summary>
/// <param name="Position">
/// Null for a favourite made now. For a game that already was one, the place it was given — by
/// another tab, which the tab asking cannot know — so that it is filed where it really stands, as the
/// timestamp is (ADR 0029 §1, ADR 0064).
/// </param>
public record FavouriteAddedDto(DateTimeOffset AddedAt, int? Position);
