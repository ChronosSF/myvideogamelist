using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>How one status list is sorted.</summary>
public record ListSortDto(string SortKey, bool Descending);

/// <summary>
/// A user's list-view preferences: one global layout, and a sort order per status list.
/// </summary>
/// <remarks>
/// <see cref="Sorts"/> contains only the lists the user has actually changed. Anything absent uses
/// the default, so the client needs a default of its own rather than expecting five entries.
/// </remarks>
public record ListPreferencesDto(string View, IReadOnlyDictionary<string, ListSortDto> Sorts);

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

public record UpdateListPreferencesDto(
    [Required]
    [AllowedValues(ListViewModes.Tiles, ListViewModes.Table)]
    string View,
    List<ListSortPreferenceDto>? Sorts);
