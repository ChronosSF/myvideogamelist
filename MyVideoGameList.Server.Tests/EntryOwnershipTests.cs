using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using MyVideoGameList.Server.Controllers;
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

    // ---------------------------------------------------------------- what stays private

    private static readonly Assembly Server = typeof(ListEntryDto).Assembly;

    /// <summary>The actions somebody who is not signed in can reach: there is no fallback policy.</summary>
    private static IEnumerable<MethodInfo> AnonymousActions() =>
        Server.GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract)
            .SelectMany(controller => controller
                .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(action => action.IsDefined(typeof(HttpMethodAttribute), inherit: true))
                .Where(action =>
                    controller.IsDefined(typeof(AllowAnonymousAttribute), inherit: true)
                    || action.IsDefined(typeof(AllowAnonymousAttribute), inherit: true)
                    || (!controller.IsDefined(typeof(AuthorizeAttribute), inherit: true)
                        && !action.IsDefined(typeof(AuthorizeAttribute), inherit: true))));

    /// <summary>
    /// Every type of ours an action's answer can contain, through its properties, the collections they
    /// hold and the task and action result around them.
    /// </summary>
    private static HashSet<Type> ReachableFrom(IEnumerable<Type> roots)
    {
        var seen = new HashSet<Type>();
        var queue = new Queue<Type>(roots);

        while (queue.TryDequeue(out var type))
        {
            if (type.IsArray)
            {
                queue.Enqueue(type.GetElementType()!);
                continue;
            }
            if (type.IsGenericType)
            {
                foreach (var argument in type.GetGenericArguments()) queue.Enqueue(argument);
            }
            if (type.Assembly != Server || !seen.Add(type)) continue;

            foreach (var property in type.GetProperties()) queue.Enqueue(property.PropertyType);
        }

        return seen;
    }

    [Fact]
    public void AnonymousActions_EveryTypeTheyAnswerWith_CarriesNoOwnershipNotesOrListRow()
    {
        // Ownership is on the list row since ADR 0055, which makes "only the owner's own reads carry a
        // ListEntryDto" the thing keeping it private (ADR 0030 §3). A public read that reused the row, or
        // grew a field of the same name, would publish it without a word; this fails first.
        var reachable = ReachableFrom(AnonymousActions().Select(action => action.ReturnType));

        // Not vacuous: the public profile and a game's member reviews are among them.
        Assert.Contains(typeof(PublicProfileDto), reachable);
        Assert.Contains(typeof(GameReviewsDto), reachable);

        Assert.DoesNotContain(typeof(ListEntryDto), reachable);
        Assert.DoesNotContain(typeof(EntryDetailDto), reachable);
        Assert.Empty(reachable.SelectMany(type => type.GetProperties())
            .Where(property => property.Name is nameof(ListEntryDto.Ownership) or nameof(EntryDetailDto.Notes))
            .Select(property => $"{property.DeclaringType!.Name}.{property.Name}"));
    }

    [Fact]
    public void AnonymousActions_LeaveOutTheListsAndTheEntry_WhichDoCarryOwnership()
    {
        // The walk above would see the row if it were exposed: the signed-in reads reach it.
        var anonymous = AnonymousActions().Select(action => action.Name).ToHashSet();

        Assert.DoesNotContain(nameof(ListsController.GetLists), anonymous);
        Assert.DoesNotContain(nameof(EntriesController.GetEntry), anonymous);
        Assert.Contains(typeof(ListEntryDto), ReachableFrom([typeof(ListsController)
            .GetMethod(nameof(ListsController.GetLists))!.ReturnType]));
    }
}
