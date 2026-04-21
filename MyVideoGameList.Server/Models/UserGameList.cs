namespace MyVideoGameList.Server.Models;

public class UserGameList
{
    public required string UserId { get; set; }

    /// <summary>IGDB game ID.</summary>
    public int GameId { get; set; }

    /// <summary>One of "playing", "backlog", or "finished".</summary>
    public required string ListType { get; set; }

    public ApplicationUser User { get; set; } = null!;
}
