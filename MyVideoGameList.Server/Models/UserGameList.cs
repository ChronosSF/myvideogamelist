namespace MyVideoGameList.Server.Models;

/// <summary>
/// Which status list a game sits in for a user. Current state only — the history of how it got
/// there lives in <see cref="UserGameEvent"/>, because this row is overwritten on every move.
/// </summary>
public class UserGameList
{
    public required string UserId { get; set; }

    /// <summary>IGDB game ID.</summary>
    public int GameId { get; set; }

    /// <summary>One of the five predefined statuses. See <see cref="ListStatus"/>.</summary>
    public short StatusId { get; set; }

    public ApplicationUser User { get; set; } = null!;
    public ListStatus Status { get; set; } = null!;
}
