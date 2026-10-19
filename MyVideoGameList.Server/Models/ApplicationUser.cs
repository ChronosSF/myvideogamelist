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
    /// <summary>
    /// The account's palette. There is one, dark, and nothing sets this any more (ADR 0048).
    /// </summary>
    /// <remarks>
    /// Kept rather than dropped because the palettes in #208 store the choice here, and kept in the
    /// export with the rest of the account. An account that chose the light theme before it was
    /// removed still says <c>light</c>; whatever reads this again must treat a value it does not know
    /// as dark.
    /// </remarks>
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
    /// The name the account is shown by on its public profile, or null for none. See
    /// <see cref="DisplayNamePolicy"/>.
    /// </summary>
    /// <remarks>
    /// <b>Not a second namespace</b> (ADR 0027): never unique, never looked up, never in a URL. The
    /// handle in <see cref="IdentityUser.UserName"/> is what identifies the account, so it is shown
    /// beside this and never replaced by it.
    /// </remarks>
    public string? DisplayName { get; set; }

    /// <summary>
    /// The address of the account's picture, or null for the handle's initial. See
    /// <see cref="AvatarUrlPolicy"/>.
    /// </summary>
    /// <remarks>
    /// Stored as given and never fetched by this server: each reader's browser loads it from its
    /// host, which is why it may only name one of a short list of hosts (ADR 0056).
    /// </remarks>
    public string? AvatarUrl { get; set; }

    /// <summary>
    /// A few lines the account's owner wrote about themselves, as plain text, or null for none. See
    /// <see cref="BioPolicy"/>.
    /// </summary>
    public string? Bio { get; set; }

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

    /// <summary>
    /// When the account was created, or null for one created before this was recorded.
    /// </summary>
    /// <remarks>
    /// Stamped by <see cref="Services.UserNameClaimService"/>, which every new account goes through.
    /// Counted for the admin statistics' sign-ups each week, and never shown one account at a time
    /// (ADR 0051). In the account's data export with the rest of it.
    /// </remarks>
    public DateTimeOffset? CreatedAt { get; set; }

    /// <summary>
    /// The first moment the account's owner was seen signed in on the last day they were, or null
    /// before that was recorded.
    /// </summary>
    /// <remarks>
    /// Written at most once a UTC day, by <c>GET /api/auth/me</c>, which the client asks on every page
    /// it loads (<see cref="Services.AccountActivity"/>). A day is all the admin statistics need —
    /// seen today, in the last week, in the last month — and anything finer would be a record of
    /// somebody's every visit that nothing reads. Counted, never shown one account at a time (ADR
    /// 0051), and in the account's data export.
    /// </remarks>
    public DateTimeOffset? LastSeenAt { get; set; }
}
