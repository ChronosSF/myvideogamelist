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
/// The signed-in user, as every page needs them.
/// </summary>
/// <remarks>
/// <paramref name="UserName"/> is what the navbar renders and what <c>/u/{userName}</c> is built
/// from; the email is still here because the account settings page shows it, but nothing public
/// does. <paramref name="ProfileVisibility"/> travels with them so the client can tell whether
/// there is a public page to link to at all, without a second request on every page load.
/// </remarks>
public record UserProfileDto(
    string Id,
    string Email,
    string UserName,
    string Theme,
    string ProfileVisibility);

public record UpdateThemeDto(string Theme);

public record UpdateHiddenPlatformsDto(IEnumerable<int> PlatformIds);

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
