namespace MyVideoGameList.Server.Models;

public class GamePublisher
{
    public int GameId { get; set; }
    public Game Game { get; set; } = null!;

    public int PublisherId { get; set; }
    public Publisher Publisher { get; set; } = null!;
}
