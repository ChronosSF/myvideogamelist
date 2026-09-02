namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One wishlisted game and when it was wishlisted.
/// </summary>
/// <remarks>
/// Deliberately not a <see cref="ListEntryDto"/>. A wishlist item carries no score and no status,
/// because the wishlist is a separate axis rather than a sixth list — reusing the list DTO would
/// mean two always-null fields and would invite client code to treat the two as interchangeable.
/// </remarks>
public record WishlistItemDto(GameDto Game, DateTimeOffset AddedAt);
