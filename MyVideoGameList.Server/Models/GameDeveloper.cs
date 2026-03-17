namespace MyVideoGameList.Server.Models;

public class GameDeveloper
{
    public int GameId { get; set; }
    public Game Game { get; set; } = null!;

    public int DeveloperId { get; set; }
    public Developer Developer { get; set; } = null!;
}
