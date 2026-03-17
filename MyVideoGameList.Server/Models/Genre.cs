namespace MyVideoGameList.Server.Models;

public class Genre
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Description { get; set; }

    public ICollection<GameGenre> GameGenres { get; set; } = [];
}
