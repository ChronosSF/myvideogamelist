using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>
/// A new account: an address to sign in with, a password, and a name to be known by.
/// </summary>
/// <remarks>
/// The username is asked for at registration rather than derived from the email and offered as a
/// change later. A derived one leaks the local part of somebody's address into a public URL, and —
/// more to the point — a name nobody chose is a name nobody notices until it is already on
/// everything they have written. See <c>docs/decisions/0027-usernames-and-public-profiles.md</c>.
/// </remarks>
public record RegisterDto(
    [Required] string Email,
    [Required] string Password,
    [Required][UserName] string UserName);

/// <param name="Email">
/// The address, or the username — both are accepted, because a person who has one memorised has
/// no reason to be told which of the two this field wanted.
/// </param>
public record LoginDto(string Email, string Password, bool RememberMe = false);

/// <summary>
/// What a registration did: the account exists, and nobody is signed in until its address is
/// confirmed (ADR 0089).
/// </summary>
/// <param name="EmailSent">
/// Whether the confirmation went to the sending service. False means the account was made and the
/// email was not, and the page offers to send it again.
/// </param>
public record RegisterResultDto(bool EmailSent);

/// <summary>The two halves of a confirmation link, as the page read them from its fragment.</summary>
public record ConfirmEmailDto([Required] string UserId, [Required] string Token);

/// <param name="Email">The address or the username, as signing in accepts either.</param>
public record ResendConfirmationDto([Required] string Email);

/// <summary>A forgotten password: the account it belongs to, named as signing in names one (ADR 0090).</summary>
/// <param name="Email">The address or the username, as signing in accepts either.</param>
public record ForgotPasswordDto([Required] string Email);

/// <summary>
/// The two halves of a reset link, as the page read them from its fragment, and the new password.
/// </summary>
/// <remarks>
/// The password's rules are Identity's, checked by the reset itself and answered as registration answers
/// them, so they are stated once, in <c>Program.cs</c>.
/// </remarks>
public record ResetPasswordDto([Required] string UserId, [Required] string Token, [Required] string Password);

/// <summary>
/// A reset that did not happen because its link was no good: expired, used, or not complete. A
/// sentence for the page, and the flag that tells it to offer another link rather than another password.
/// </summary>
public record ResetLinkRefusedDto(string Message, bool InvalidLink = true);

/// <summary>
/// A sentence for the page to show, which is all an anonymous auth endpoint with no account to
/// answer with ever sends: declared, so that nothing else can be (<c>TagPrivacyTests</c>).
/// </summary>
public record AuthMessageDto(string Message);

/// <summary>
/// The signed-in user, as every page needs them.
/// </summary>
/// <remarks>
/// <para>
/// <paramref name="UserName"/> is what the navbar renders and what <c>/u/{userName}</c> is built
/// from; the email is still here because the account settings page shows it, but nothing public
/// does. <paramref name="ProfileVisibility"/> travels with them so the client can tell whether
/// there is a public page to link to at all, without a second request on every page load.
/// </para>
/// <para>
/// <paramref name="IsAdmin"/> is there for the same reason, so the navbar can link to the admin page
/// (spec §7, A6). It decides what the client shows and nothing else: every admin endpoint asks the
/// policy for itself.
/// </para>
/// <para>
/// <paramref name="DisplayName"/>, <paramref name="AvatarUrl"/> and <paramref name="Bio"/> are what
/// the settings page edits, and they ride here rather than behind a request of their own so that a
/// save can hand the whole profile back as the other changes do. None is more than a few hundred
/// characters, and this is the signed-in user's own response, never a shared one.
/// </para>
/// </remarks>
public record UserProfileDto(
    string Id,
    string Email,
    string UserName,
    string? DisplayName,
    string? AvatarUrl,
    string? Bio,
    LookDto Look,
    bool CanChooseLook,
    string ProfileVisibility,
    bool IsAdmin)
{
    /// <summary>
    /// The one projection, for every endpoint that answers with the signed-in user — signing in,
    /// <c>me</c>, and each change to the profile — so that none of them can hand the client a
    /// profile that is missing something the others carry.
    /// </summary>
    public static UserProfileDto For(ApplicationUser user, bool isAdmin) =>
        new(
            user.Id,
            user.Email!,
            user.UserName!,
            user.DisplayName,
            user.AvatarUrl,
            user.Bio,
            LookDto.For(user, LookPolicy.CanChoose(isAdmin)),
            LookPolicy.CanChoose(isAdmin),
            user.ProfileVisibility,
            isAdmin);
}

/// <summary>
/// How the site looks to its owner (ADR 0082): a palette by name, a custom palette's two colours, the
/// background pattern and its tint. On the profile, so that every page knows it from the request it
/// already makes, and the browser keeps a copy of it to apply before the first paint.
/// </summary>
/// <param name="Background">A custom palette's background, <c>#rrggbb</c>; null for a preset.</param>
/// <param name="Accent">A custom palette's accent, <c>#rrggbb</c>; null for a preset.</param>
public record LookDto(string Palette, string? Background, string? Accent, string Pattern, string Tint)
{
    /// <summary>The look of an account that may choose none: the default, whatever it last chose.</summary>
    public static readonly LookDto Default = new(
        LookPolicy.DefaultPalette, null, null, LookPolicy.DefaultPattern, LookPolicy.DefaultTint);

    /// <summary>
    /// The look an account is drawn in: the one it chose, its palette read through
    /// <see cref="LookPolicy.PaletteOf"/>, if it may choose one, and otherwise the default.
    /// </summary>
    /// <remarks>
    /// What it chose stays stored either way, so an account that may choose again is drawn in it again.
    /// The browser's copy of the look follows this answer on the next page, which is how an account that
    /// may no longer choose loses its look on every device without anything reaching into a browser.
    /// </remarks>
    public static LookDto For(ApplicationUser user, bool canChoose)
    {
        if (!canChoose) return Default;

        var palette = LookPolicy.PaletteOf(user.Theme);
        var custom = palette == LookPolicy.CustomPalette;
        return new(
            palette,
            custom ? user.ThemeBackground : null,
            custom ? user.ThemeAccent : null,
            LookPolicy.Patterns.Contains(user.BackgroundPattern) ? user.BackgroundPattern : LookPolicy.DefaultPattern,
            LookPolicy.Tints.Contains(user.PatternTint) ? user.PatternTint : LookPolicy.DefaultTint);
    }
}

/// <summary>
/// A new look, all of it at once, as the settings page sends it with every change.
/// </summary>
/// <remarks>
/// The names are checked against <see cref="LookPolicy"/>'s lists rather than restated in
/// <see cref="AllowedValuesAttribute"/>s, which take only constants: a palette added later is one entry
/// there and one check constraint. A preset's colours are the stylesheet's and are not sent; a custom
/// palette must send both of its own. Whether a custom palette reads is the page's to check (see
/// <see cref="LookPolicy"/>).
/// </remarks>
public record UpdateLookDto(
    [Required] string Palette,
    [RegularExpression(LookPolicy.ColourPattern)] string? Background,
    [RegularExpression(LookPolicy.ColourPattern)] string? Accent,
    [Required] string Pattern,
    [Required] string Tint) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (!LookPolicy.Palettes.Contains(Palette))
            yield return new($"The palette must be one of {string.Join(", ", LookPolicy.Palettes)}.", [nameof(Palette)]);
        if (!LookPolicy.Patterns.Contains(Pattern))
            yield return new($"The pattern must be one of {string.Join(", ", LookPolicy.Patterns)}.", [nameof(Pattern)]);
        if (!LookPolicy.Tints.Contains(Tint))
            yield return new($"The pattern's colour must be one of {string.Join(", ", LookPolicy.Tints)}.", [nameof(Tint)]);
        if (Palette == LookPolicy.CustomPalette && (Background is null || Accent is null))
            yield return new("A custom palette needs a background and an accent.", [nameof(Background), nameof(Accent)]);
    }
}

/// <summary>A rename. The one field, validated the same way registration validates it.</summary>
public record UpdateUserNameDto([Required][UserName] string UserName);

/// <summary>
/// Whether the account has a public page.
/// </summary>
/// <remarks>
/// Validated by <see cref="AllowedValuesAttribute"/> against <see cref="ProfileVisibility"/> rather
/// than against a second list of literals, exactly as <c>ReviewInputDto</c> does for a review's own
/// visibility. A third value later is then one constant and one check constraint.
/// </remarks>
public record UpdateProfileVisibilityDto(
    [Required]
    [AllowedValues(ProfileVisibility.Public, ProfileVisibility.Private)]
    string ProfileVisibility);

/// <summary>
/// What the account says about itself on its public profile: the name it is shown by, a picture,
/// and a few lines. All three at once, each optional.
/// </summary>
/// <remarks>
/// <para>
/// A replacement rather than a patch: the settings form shows all three and saves them together, so
/// a field left out or sent blank is a field cleared. Each is judged as it will be stored — see
/// <see cref="ProfileDetailAttribute"/> — and a refusal comes back keyed by its field.
/// </para>
/// <para>
/// The attributes target the constructor parameters, as <see cref="ReviewInputDto"/>'s do. See ADR
/// 0056 for what each one allows and why.
/// </para>
/// </remarks>
public record UpdateProfileDetailsDto(
    [DisplayNameText] string? DisplayName,
    [AvatarUrl] string? AvatarUrl,
    [BioText] string? Bio);
