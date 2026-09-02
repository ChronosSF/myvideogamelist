using Microsoft.AspNetCore.Identity;

namespace MyVideoGameList.Server.Models;

public class ApplicationUser : IdentityUser
{
    public string Theme { get; set; } = "dark";

    /// <summary>
    /// Tiles or table, for the list views. Global rather than per list: the layout is a habit,
    /// whereas the sort order genuinely differs between Playing and Finished, which is why that
    /// one lives in <see cref="UserListSortPreference"/> instead.
    /// </summary>
    public string ListView { get; set; } = ListViewModes.Tiles;
}
