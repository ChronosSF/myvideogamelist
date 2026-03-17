namespace MyVideoGameList.Server.Models;

public class Developer
{
    public int Id { get; set; }
    public required string Name { get; set; }
    public string? Country { get; set; }
    public int? FoundedYear { get; set; }
    public string? Website { get; set; }
    public string? LogoUrl { get; set; }
    public string? Description { get; set; }

    public ICollection<GameDeveloper> GameDevelopers { get; set; } = [];
}
