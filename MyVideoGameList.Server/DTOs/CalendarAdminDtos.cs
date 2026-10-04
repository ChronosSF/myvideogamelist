using System.ComponentModel.DataAnnotations;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.DTOs;

/// <summary>A curated event as the admin page lists it.</summary>
public record CuratedEventDto(
    int Id,
    string Kind,
    string? Store,
    string Name,
    DateOnly StartsOn,
    DateOnly EndsOn,
    string Url,
    DateTimeOffset UpdatedAt);

/// <summary>
/// A curated event as the admin page sends it, to add one or to replace one — spec §6, S1.
/// </summary>
/// <remarks>
/// <para>
/// The days are nullable only so that <see cref="RequiredAttribute"/> can see one missing: a
/// <see cref="DateOnly"/> left out of the body would otherwise bind as the first of January of year
/// one and be saved as that.
/// </para>
/// <para>
/// The address is held to <c>http</c> and <c>https</c> rather than to what <see cref="UrlAttribute"/>
/// accepts. The calendar is shown to everybody, and an address it renders as a link has to be one a
/// link can safely point at.
/// </para>
/// </remarks>
public record CuratedEventInputDto(
    [Required]
    [AllowedValues(CuratedEventKinds.Sale, CuratedEventKinds.Fest, CuratedEventKinds.Showcase)]
    string Kind,
    [AllowedValues(
        null,
        CuratedEventStores.Steam,
        CuratedEventStores.Epic,
        CuratedEventStores.PlayStation,
        CuratedEventStores.Xbox,
        CuratedEventStores.Nintendo,
        CuratedEventStores.Gog)]
    string? Store,
    [Required][StringLength(CuratedEvent.NameMaxLength)] string Name,
    [Required] DateOnly? StartsOn,
    [Required] DateOnly? EndsOn,
    [Required][StringLength(CuratedEvent.UrlMaxLength)] string Url) : IValidatableObject
{
    public IEnumerable<ValidationResult> Validate(ValidationContext validationContext)
    {
        if (StartsOn is { } starts && EndsOn is { } ends && ends < starts)
            yield return new ValidationResult("The last day cannot be before the first.", [nameof(EndsOn)]);

        if (!string.IsNullOrWhiteSpace(Url)
            && !(Uri.TryCreate(Url.Trim(), UriKind.Absolute, out var address)
                 && (address.Scheme == Uri.UriSchemeHttps || address.Scheme == Uri.UriSchemeHttp)))
        {
            yield return new ValidationResult("The link has to be a web address, starting http:// or https://.", [nameof(Url)]);
        }
    }
}

/// <summary>A showcase name as the admin page lists it.</summary>
public record ShowcaseNameDto(int Id, string Prefix);

/// <summary>A showcase name to add. There is no edit: a name is removed and the right one added.</summary>
public record ShowcaseNameInputDto([Required][StringLength(ShowcaseName.PrefixMaxLength)] string Prefix);
