namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One of the user's favourite games and when they made it one.
/// </summary>
/// <remarks>
/// Its own record rather than a <see cref="WishlistItemDto"/>, although the two carry the same
/// fields: they are different axes, and a shared type invites code that treats wanting a game and
/// loving one as interchangeable — the reason the wishlist's own DTO is not a list entry either.
/// </remarks>
public record FavouriteDto(GameDto Game, DateTimeOffset AddedAt);

/// <summary>
/// The answer to making a game a favourite: when it became one, which for a game that already was
/// one is the original time rather than now.
/// </summary>
public record FavouriteAddedDto(DateTimeOffset AddedAt);
