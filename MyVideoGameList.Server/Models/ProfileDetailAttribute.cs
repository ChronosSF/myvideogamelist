using System.ComponentModel.DataAnnotations;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// Validates one of the three things an account says about itself on its public profile, against
/// the policy for it.
/// </summary>
/// <remarks>
/// <para>
/// Attributes rather than guards in the controller, for <see cref="UserNameAttribute"/>'s reason:
/// <c>[ApiController]</c> returns the 400 itself, as a <c>ValidationProblemDetails</c> with the
/// message keyed by the field it is about, which is the shape every other refusal in this API takes.
/// </para>
/// <para>
/// Each judges the value as it will be stored — normalised first — so that a name refused for its
/// length is refused for the length it would have had, not for the spaces around it. A blank is
/// always allowed: all three are optional, and a blank is how one is cleared.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter, AllowMultiple = false)]
public abstract class ProfileDetailAttribute : ValidationAttribute
{
    /// <summary>The value as it will be stored, or null for a clear.</summary>
    protected abstract string? Normalise(string? value);

    /// <summary>Why a normalised value cannot be stored, or null when it can.</summary>
    protected abstract string? Problem(string normalised);

    protected sealed override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        if (Normalise(value as string) is not { } normalised) return ValidationResult.Success;

        return Problem(normalised) is { } problem
            ? new ValidationResult(problem, context.MemberName is null ? null : [context.MemberName])
            : ValidationResult.Success;
    }
}

/// <summary>A display name, by <see cref="DisplayNamePolicy"/>.</summary>
public sealed class DisplayNameTextAttribute : ProfileDetailAttribute
{
    protected override string? Normalise(string? value) => DisplayNamePolicy.Normalise(value);
    protected override string? Problem(string normalised) => DisplayNamePolicy.Problem(normalised);
}

/// <summary>An avatar's address, by <see cref="AvatarUrlPolicy"/>.</summary>
public sealed class AvatarUrlAttribute : ProfileDetailAttribute
{
    protected override string? Normalise(string? value) => AvatarUrlPolicy.Normalise(value);
    protected override string? Problem(string normalised) => AvatarUrlPolicy.Problem(normalised);
}

/// <summary>A bio, by <see cref="BioPolicy"/>.</summary>
public sealed class BioTextAttribute : ProfileDetailAttribute
{
    protected override string? Normalise(string? value) => BioPolicy.Normalise(value);
    protected override string? Problem(string normalised) => BioPolicy.Problem(normalised);
}
