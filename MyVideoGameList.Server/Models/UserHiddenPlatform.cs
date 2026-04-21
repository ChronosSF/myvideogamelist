namespace MyVideoGameList.Server.Models;

public class UserHiddenPlatform
{
    public required string UserId { get; set; }

    /// <summary>IGDB platform ID that the user wants to hide from the filter UI.</summary>
    public int IgdbPlatformId { get; set; }

    public ApplicationUser User { get; set; } = null!;
}
