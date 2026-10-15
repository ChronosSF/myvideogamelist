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
/// one is the original time rather than now.
/// </summary>
public record FavouriteAddedDto(DateTimeOffset AddedAt);
