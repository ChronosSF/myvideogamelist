using Microsoft.AspNetCore.Identity;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// Who may see a user's profile page.
/// </summary>
/// <remarks>
/// A string rather than a boolean, for the reason <see cref="ReviewVisibility"/> gives and on the
/// same foreseeable third value: <c>friends</c>, once a follow graph exists. Adding a value to a
/// string column is additive; splitting a boolean into three states is not.
/// </remarks>
public static class ProfileVisibility
{
    public const string Public = "public";
    public const string Private = "private";
}

public class ApplicationUser : IdentityUser
{
    public string Theme { get; set; } = "dark";

    /// <summary>
    /// Tiles or table, for the list views. Global rather than per list: the layout is a habit,
    /// whereas the sort order genuinely differs between Playing and Finished, which is why that
    /// one lives in <see cref="UserListSortPreference"/> instead.
    /// </summary>
    public string ListView { get; set; } = ListViewModes.Tiles;

    /// <summary>
    /// Whether this account has a public page at <c>/u/{UserName}</c>. One of
    /// <see cref="Models.ProfileVisibility"/>.
    /// </summary>
    /// <remarks>
    /// <b>Defaults to private, including for accounts created after this shipped.</b> Publishing
    /// somebody's reading of their own library — what they abandoned, how they score things, how
    /// long they took — is a consent decision, and a default is not consent. ADR 0025 made the same
    /// call for a review's own visibility and gave the argument in full; this is the outer gate
    /// over that one, and the narrower of the two always wins: a public review on a private profile
    /// is not visible to anybody.
    /// </remarks>
    public string ProfileVisibility { get; set; } = Models.ProfileVisibility.Private;

    /// <summary>
    /// When <see cref="IdentityUser.UserName"/> was last changed, or null if it never has been.
    /// </summary>
    /// <remarks>
    /// A username is a public address that other people link to, so renaming one breaks every link
    /// to it and frees the old name for somebody else to claim. Neither is a reason to forbid a
    /// rename — people outgrow a name they picked in a hurry — but both are reasons not to allow an
    /// unbounded stream of them, which is how a namespace gets churned for squatting. This column
    /// is what the cooldown in <c>UserController</c> is measured from.
    /// </remarks>
    public DateTimeOffset? UserNameChangedAt { get; set; }
}
