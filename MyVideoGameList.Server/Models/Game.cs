namespace MyVideoGameList.Server.Models;

public class Game
{
    public int Id { get; set; }
    public required string Title { get; set; }
    public string? Description { get; set; }
    public DateOnly? ReleaseDate { get; set; }
    public string? CoverImageUrl { get; set; }
    public string? BackgroundImageUrl { get; set; }
    public string? TrailerUrl { get; set; }
    public string? Website { get; set; }
    public float? Rating { get; set; }
    public int? MetacriticScore { get; set; }
    public string? EsrbRating { get; set; }

    public ICollection<GamePlatform> GamePlatforms { get; set; } = [];
    public ICollection<GameGenre> GameGenres { get; set; } = [];
    public ICollection<GameDeveloper> GameDevelopers { get; set; } = [];
    public ICollection<GamePublisher> GamePublishers { get; set; } = [];
}
