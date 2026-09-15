using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// The ownership values are written down three times — the request DTO's attribute, the service's
/// set and the database's check constraint — and these tests fail if the three ever disagree.
/// </summary>
/// <remarks>
/// A value the DTO accepts and the constraint refuses is a 500; one the constraint accepts and the
/// DTO refuses is a feature that cannot be reached. Neither shows up until somebody picks that value.
/// </remarks>
public class EntryOwnershipTests
{
    private static readonly string[] Kinds =
        [OwnershipKinds.Owned, OwnershipKinds.Subscription, OwnershipKinds.Borrowed];

    /// <summary>
    /// The validation attributes on a record's constructor parameter, which is where MVC reads them
    /// and where <c>Validator.TryValidateObject</c> — which reads properties — would not look.
    /// </summary>
    private static ValidationAttribute[] AttributesOf<TDto>(string parameter) =>
        typeof(TDto).GetConstructors().Single().GetParameters()
            .Single(p => p.Name == parameter)
            .GetCustomAttributes<ValidationAttribute>()
            .ToArray();

    private static bool Accepts<TDto>(string parameter, object? value) =>
        AttributesOf<TDto>(parameter).All(attribute => attribute.IsValid(value));

    [Fact]
    public void SetOwnershipDto_AcceptsEveryKindAndNull()
    {
        foreach (var kind in Kinds) Assert.True(Accepts<SetOwnershipDto>("Ownership", kind), kind);

        // The trap this pins: AllowedValues refuses null unless null is one of its values, and a
        // clear is a null.
        Assert.True(Accepts<SetOwnershipDto>("Ownership", null));
    }

    [Theory]
    [InlineData("stolen")]
    [InlineData("OWNED")]
    [InlineData("")]
    public void SetOwnershipDto_RefusesAnythingElse(string value) =>
        Assert.False(Accepts<SetOwnershipDto>("Ownership", value));

    [Fact]
    public void TheServiceAcceptsExactlyTheKinds() =>
        Assert.Equal(Kinds.Order(), ListService.OwnershipValues.Order());

    [Fact]
    public void TheCheckConstraintNamesEveryKind()
    {
        using var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);

        // The design-time model: check constraints are migration metadata, which the read-optimised
        // runtime model does not keep.
        var constraint = db.GetService<IDesignTimeModel>().Model
            .FindEntityType(typeof(UserGameEntry))!
            .GetCheckConstraints()
            .Single(c => c.ModelName == "CK_UserGameEntries_Ownership");

        foreach (var kind in Kinds) Assert.Contains($"'{kind}'", constraint.Sql);
    }

    [Fact]
    public void SetNotesDto_RefusesMoreThanTheColumnHolds()
    {
        Assert.True(Accepts<SetNotesDto>("Notes", new string('a', 2000)));
        Assert.False(Accepts<SetNotesDto>("Notes", new string('a', 2001)));
        Assert.True(Accepts<SetNotesDto>("Notes", null));
    }
}
