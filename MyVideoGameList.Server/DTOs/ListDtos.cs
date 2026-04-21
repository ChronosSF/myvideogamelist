namespace MyVideoGameList.Server.DTOs;

public record SetListEntryDto(string ListType);

public record ListsDto(
    IEnumerable<GameDto> Playing,
    IEnumerable<GameDto> Backlog,
    IEnumerable<GameDto> Finished);
