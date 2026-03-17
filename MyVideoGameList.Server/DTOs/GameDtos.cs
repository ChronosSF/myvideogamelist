namespace MyVideoGameList.Server.DTOs;

public record PlatformDto(int Id, string Name, string Abbreviation, string? LogoUrl, string? Manufacturer);

public record GenreDto(int Id, string Name, string? Description);

public record DeveloperDto(
    int Id,
    string Name,
    string? Country,
    int? FoundedYear,
    string? Website,
    string? LogoUrl,
    string? Description);

public record PublisherDto(
    int Id,
    string Name,
    string? Country,
    int? FoundedYear,
    string? Website,
    string? LogoUrl,
    string? Description);

public record GameDto(
    int Id,
    string Title,
    string? Description,
    DateOnly? ReleaseDate,
    string? CoverImageUrl,
    string? BackgroundImageUrl,
    string? TrailerUrl,
    string? Website,
    float? Rating,
    int? MetacriticScore,
    string? EsrbRating,
    IEnumerable<PlatformDto> Platforms,
    IEnumerable<GenreDto> Genres,
    IEnumerable<DeveloperDto> Developers,
    IEnumerable<PublisherDto> Publishers);
