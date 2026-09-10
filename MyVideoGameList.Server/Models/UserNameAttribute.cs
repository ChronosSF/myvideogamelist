using System.ComponentModel.DataAnnotations;

namespace MyVideoGameList.Server.Models;

/// <summary>
/// Validates a proposed username against <see cref="UserNamePolicy"/>.
/// </summary>
/// <remarks>
/// <para>
/// An attribute rather than a guard in the controller, so <c>[ApiController]</c> returns the 400
/// itself and the message lands beside the field — the same shape every other validation failure in
/// this API takes. A <c>[RegularExpression]</c> and a <c>[StringLength]</c> would nearly do it, but
/// they would restate the length and the alphabet a second time and could say nothing at all about
/// the reserved list.
/// </para>
/// <para>
/// It answers "may this be a username", never "is this username free". Availability is a fact about
/// the database at one instant and belongs to the write that races for it.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Parameter, AllowMultiple = false)]
public sealed class UserNameAttribute : ValidationAttribute
{
    protected override ValidationResult? IsValid(object? value, ValidationContext context)
    {
        // Absence is [Required]'s question, not this one — answering it here too would put two
        // messages under one empty field.
        if (value is null) return ValidationResult.Success;

        var result = UserNamePolicy.Check(value as string);

        return result == UserNamePolicy.Result.Ok
            ? ValidationResult.Success
            : new ValidationResult(
                UserNamePolicy.Message(result),
                context.MemberName is null ? null : [context.MemberName]);
    }
}
