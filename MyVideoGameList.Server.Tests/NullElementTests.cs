using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.ModelBinding.Validation;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// A list body with a <c>null</c> among its elements is a 400, not a 500. Model validation passes over
/// a null element of a collection without a word, so each body refuses one itself.
/// </summary>
/// <remarks>
/// Validated the way MVC does before an <c>[ApiController]</c> action runs, through its own object
/// validator, which reads the attributes on a record's constructor parameters and then calls
/// <see cref="System.ComponentModel.DataAnnotations.IValidatableObject.Validate"/>. An invalid model
/// state there is the automatic 400.
/// </remarks>
public class NullElementTests
{
    private static Outcome ValidateAsMvcDoes(object body)
    {
        var services = new ServiceCollection().AddLogging().AddMvcCore().AddDataAnnotations().Services
            .BuildServiceProvider();
        var action = new ActionContext(
            new DefaultHttpContext { RequestServices = services }, new RouteData(), new ActionDescriptor());

        services.GetRequiredService<IObjectModelValidator>()
            .Validate(action, validationState: null, prefix: string.Empty, model: body);

        return new Outcome(action.ModelState.IsValid, action.ModelState.Keys.ToList());
    }

    private sealed record Outcome(bool IsValid, List<string> Keys);

    [Fact]
    public void UpdateListNamesDto_ANullAmongTheNames_IsRefused()
    {
        var result = ValidateAsMvcDoes(new UpdateListNamesDto([null!]));

        Assert.False(result.IsValid);
        Assert.Contains(nameof(UpdateListNamesDto.Names), result.Keys);
    }

    [Fact]
    public void UpdateListNamesDto_NoListAtAll_IsRefusedBeforeItsElementsAreRead()
    {
        // [Required] fails first, and Validate, which reads the elements, is not reached.
        var result = ValidateAsMvcDoes(new UpdateListNamesDto(null!));

        Assert.False(result.IsValid);
        Assert.Contains(nameof(UpdateListNamesDto.Names), result.Keys);
    }

    [Fact]
    public void UpdateListPreferencesDto_ANullAmongTheSorts_IsRefused()
    {
        var result = ValidateAsMvcDoes(new UpdateListPreferencesDto(ListViewModes.Table, [null!]));

        Assert.False(result.IsValid);
        Assert.Contains(nameof(UpdateListPreferencesDto.Sorts), result.Keys);
    }

    [Fact]
    public void UpdateListPreferencesDto_NoSortsAtAll_IsAccepted() =>
        // Optional: a layout saved on its own leaves the sorts as they are.
        Assert.True(ValidateAsMvcDoes(new UpdateListPreferencesDto(ListViewModes.Tiles, null)).IsValid);

    [Fact]
    public void UpdateListNamesDto_EveryNameGiven_IsAccepted() =>
        Assert.True(ValidateAsMvcDoes(new UpdateListNamesDto([new ListNameInputDto(ListStatusKeys.Backlog, "Pile")])).IsValid);

    [Fact]
    public void ImportDecisionsDto_ANullAmongTheRows_IsRefused()
    {
        var result = ValidateAsMvcDoes(new ImportDecisionsDto([new ImportRowDecisionDto(1, "import", null, null), null!]));

        Assert.False(result.IsValid);
        Assert.Contains(nameof(ImportDecisionsDto.Rows), result.Keys);
    }

    [Fact]
    public void ImportDecisionsDto_EveryRowGiven_IsAccepted() =>
        Assert.True(ValidateAsMvcDoes(new ImportDecisionsDto([new ImportRowDecisionDto(1, "import", null, null)])).IsValid);
}
