namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// One news item, already joined to the game it belongs to so the client can render a card
/// without a second lookup.
/// </summary>
/// <param name="Id">Steam's <c>gid</c>, stable per item and used as the React key.</param>
/// <param name="Excerpt">
/// Plain text. Steam returns BBCode and HTML in <c>contents</c>; it is flattened server-side so
/// no consumer is ever tempted to reach for <c>dangerouslySetInnerHTML</c>.
/// </param>
public record NewsItemDto(
    string Id,
    int GameId,
    string GameTitle,
    string? GameCoverUrl,
    string Title,
    string Url,
    string Source,
    string? Excerpt,
    DateTimeOffset PublishedAt);
