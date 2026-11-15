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
    /// The account's palette, by name: one of <see cref="LookPolicy.Palettes"/> (ADR 0082). Every palette
    /// is dark (ADR 0048).
    /// </summary>
    /// <remarks>
    /// The column the dark theme left, kept for this (issue 208), and in the export with the rest of the
    /// account. The migration that brought the palettes rewrote the <c>dark</c> and <c>light</c> it held
    /// to the default; a reader still goes through <see cref="LookPolicy.PaletteOf"/>, so a name a later
    /// release retires reads as the default rather than as nothing.
    /// </remarks>
    public string Theme { get; set; } = LookPolicy.DefaultPalette;

    /// <summary>
    /// A custom palette's background and accent, as <c>#rrggbb</c> in lower case; both set when
    /// <see cref="Theme"/> is <c>custom</c>, and neither otherwise, as the table's check says. The rest of a
    /// custom palette, its surfaces and the accent's lighter and darker steps, is the stylesheet's to work
    /// out from these two, as it does for every preset.
    /// </summary>
    public string? ThemeBackground { get; set; }

    /// <inheritdoc cref="ThemeBackground"/>
    public string? ThemeAccent { get; set; }

    /// <summary>
    /// The pattern drawn behind the top and the foot of every page, by name: one of
    /// <see cref="LookPolicy.Patterns"/>, <c>none</c> among them (ADR 0082).
    /// </summary>
    public string BackgroundPattern { get; set; } = LookPolicy.DefaultPattern;

    /// <summary>Whether that pattern is drawn in the page's grey or in the palette's accent.</summary>
    public string PatternTint { get; set; } = LookPolicy.DefaultTint;

    /// <summary>
    /// Tiles or table, for the list views. Global rather than per list: the layout is a habit,
    /// whereas the sort order genuinely differs between Playing and Finished, which is why that
    /// one lives in <see cref="UserListSortPreference"/> instead.
    /// </summary>
    public string ListView { get; set; } = ListViewModes.Tiles;

    /// <summary>
    /// The profile's address: <c>/u/{PublicId}/{UserName}</c>, where only this half is looked up
    /// (ADR 0096). See <see cref="PublicIdPolicy"/>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Made when the account is: a new account draws one the first time this is read, which saving it
    /// does, and <see cref="Services.UserNameClaimService"/> draws again before the account is saved if
    /// this one is taken. A row EF reads back is given its stored id through the setter, so loading an
    /// account draws nothing. It never changes after that, so a rename breaks no link and hands none to
    /// whoever claims the old name next.
    /// </para>
    /// <para>
    /// Public by design, and so never the account id, which is half of every confirmation and reset
    /// link (ADR 0089). It is in the account's export and is not imported: an id names an account, and
    /// a file imported into another account is that account's data under that account's id.
    /// </para>
    /// </remarks>
    public string PublicId
    {
        get => drawnPublicId ??= PublicIdPolicy.New();
        set => drawnPublicId = value;
    }

    /// <summary>
    /// <see cref="PublicId"/>'s value, named so that EF's conventions do not take it for the backing
    /// field: EF goes through the property, so an account saved without its id read still draws one.
    /// </summary>
    private string? drawnPublicId;

    /// <summary>
    /// Whether this account has a public page at <c>/u/{PublicId}/{UserName}</c>. One of
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
    /// A rename frees the old name for somebody else to claim. Since the profile's address is its
    /// <see cref="PublicId"/>, a rename no longer breaks a link to it (ADR 0096), but an unbounded stream
    /// of renames is still how a namespace gets churned by somebody cycling names to squat them, the
    /// second of ADR 0027's two reasons. This column is what the cooldown in <c>UserController</c> is
    /// measured from.
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

    /// <summary>
    /// When the account last ended every session it had, or null if it never has: the moment its
    /// password was reset (ADR 0090). Written by <see cref="Security.AccountSessions.EndAll"/>, and only with
    /// a write that changes the security stamp.
    /// </summary>
    /// <remarks>
    /// <para>
    /// A session that began at or before this moment, under a security stamp that is no longer the
    /// account's, is refused at its next request (<see cref="Security.AccountSessions"/>). The
    /// stamp alone cannot say that: a rename changes it too, and a rename leaves the account's other
    /// sessions to Identity's own check, half an hour later (ADR 0077 §4). The moment alone cannot
    /// either: a session's start is kept to the second, so one signed in just after a reset would read
    /// as one from before it.
    /// </para>
    /// <para>
    /// Recorded about the account rather than entered by its owner, and in the account's data export for
    /// the reason <see cref="LastSeenAt"/> is.
    /// </para>
    /// </remarks>
    public DateTimeOffset? SessionsEndedAt { get; set; }
}
