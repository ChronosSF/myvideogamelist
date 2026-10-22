using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>How one status list is sorted.</summary>
public record ListSortDto(string SortKey, bool Descending);

/// <summary>
/// A user's list-view preferences: one global layout, a sort order per status list, and what they
/// call each list.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="Sorts"/> and <see cref="Names"/> contain only the lists the user has actually changed.
/// Anything absent uses the default, so the client needs defaults of its own rather than expecting
/// five entries of each.
/// </para>
/// <para>
/// The names ride here, on a read the lists provider already makes on every sign-in, because every
/// page that shows a list's name is under that provider. A request of their own would be one more
/// round trip on every page load for five short strings.
/// </para>
/// </remarks>
/// <param name="Names">Status key to display name, for renamed lists only.</param>
public record ListPreferencesDto(
    string View,
    IReadOnlyDictionary<string, ListSortDto> Sorts,
    IReadOnlyDictionary<string, string> Names);

/// <summary>
/// What one list should be called, on the way in. A null, empty or whitespace name — or the default
/// name itself — puts the list back to its default.
/// </summary>
/// <remarks>
/// The length bound here is loose on purpose. It caps a request; the real limit applies to the name
/// once <see cref="ListNamePolicy"/> has normalised it, and comes back beside the field that broke it.
/// </remarks>
public record ListNameInputDto(
    [Required]
    [AllowedValues(
        ListStatusKeys.Backlog,
        ListStatusKeys.Playing,
        ListStatusKeys.OnHold,
        ListStatusKeys.Finished,
        ListStatusKeys.Dropped)]
    string Status,
    [MaxLength(200)] string? Name);

/// <summary>
/// Every list's name at once, replacing whatever was saved — the same whole-set contract the sort
/// preferences use, so a list left out goes back to its default.
/// </summary>
/// <remarks>
/// A <c>null</c> among the names is refused here, as a 400. Model validation passes over a null
/// element of a collection without a word, so <c>[null]</c> would otherwise reach the service and
/// fail there as a 500.
/// </remarks>
public record UpdateListNamesDto([Required] List<ListNameInputDto> Names) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Names.Any(name => name is null))
            yield return new ValidationResult("Every entry must name a list.", [nameof(Names)]);
    }
}

/// <summary>The names as saved, normalised, for renamed lists only.</summary>
public record ListNamesDto(IReadOnlyDictionary<string, string> Names);

/// <summary>
/// One list's sort order, on the way in.
/// </summary>
/// <remarks>
/// Attributes on the constructor parameters, and validated by MVC recursing into the collection on
/// <see cref="UpdateListPreferencesDto"/> — which is why the sort map arrives as a list of records
/// rather than a dictionary. Dictionary values are not reached by model validation, so a dictionary
/// would have meant hand-rolled guards in the controller.
/// </remarks>
public record ListSortPreferenceDto(
    [Required]
    [AllowedValues(
        ListStatusKeys.Backlog,
        ListStatusKeys.Playing,
        ListStatusKeys.OnHold,
        ListStatusKeys.Finished,
        ListStatusKeys.Dropped)]
    string Status,
    [Required]
    [AllowedValues(
        ListSortKeys.Added,
        ListSortKeys.StatusChanged,
        ListSortKeys.Title,
        ListSortKeys.ReleaseDate,
        ListSortKeys.Score,
        ListSortKeys.Rating,
        ListSortKeys.CriticScore)]
    string SortKey,
    bool Descending);

/// <remarks>
/// A <c>null</c> among the sorts is refused here, as a 400, for the reason <see cref="UpdateListNamesDto"/>
/// gives. Left to the controller it was a 500, and one that came after the layout had already been saved.
/// </remarks>
public record UpdateListPreferencesDto(
    [Required]
    [AllowedValues(ListViewModes.Tiles, ListViewModes.Table)]
    string View,
    List<ListSortPreferenceDto>? Sorts) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (Sorts?.Any(sort => sort is null) == true)
            yield return new ValidationResult("Every sort must name a list.", [nameof(Sorts)]);
    }
}
