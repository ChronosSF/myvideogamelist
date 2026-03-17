namespace MyVideoGameList.Server.Models;

public class Platform
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public required string Abbreviation { get; set; }
    public string? LogoUrl { get; set; }
    public string? Manufacturer { get; set; }

    public ICollection<GamePlatform> GamePlatforms { get; set; } = [];
}
