using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>Where one game goes in a hand-arranged order. See <see cref="IHandOrdered"/>.</summary>
/// <remarks>
/// Attributes on the constructor parameters, validated by MVC recursing into the collection on
/// <see cref="SetPositionsDto"/> — the reason the positions arrive as a list of records rather than a
/// dictionary keyed by game, whose values model validation never reaches.
/// </remarks>
public record PositionDto(
    [Range(1, int.MaxValue)] int GameId,
    [Range(HandOrder.MinPosition, HandOrder.MaxPosition)] int Position);

/// <summary>
/// Some of a list's games, placed. Only the games named move; every other game in the list keeps the
/// position it had, which is what keeps a move to one row.
/// </summary>
/// <remarks>
/// <para>
/// A game named twice takes the last of its positions, as a list named twice in the sort preferences
/// takes its last sort. A game that is not in the list — moved out of it from another tab since this
/// one loaded — is passed over rather than refused: its place in the list went with it.
/// </para>
/// <para>
/// A <c>null</c> among the positions is refused here, as a 400. Model validation passes over a null
/// element of a collection without a word, so <c>[null]</c> would otherwise reach the store and fail
/// there as a 500.
/// </para>
/// </remarks>
public record SetPositionsDto(
    [Required]
    [MinLength(1)]
    [MaxLength(HandOrder.MaxWrites)]
    List<PositionDto> Positions) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Positions.Any(position => position is null))
            yield return new ValidationResult("Every position must name a game.", [nameof(Positions)]);
    }
}
