using System.Reflection;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Tags are their owner's alone: nothing anybody can read without that owner's cookie carries one.
/// </summary>
/// <remarks>
/// <para>
/// What keeps them private is that only the owner's own reads answer with a <see cref="ListEntryDto"/> or
/// a <see cref="TagDto"/>, and that the public profile is assembled field by field (ADR 0027 §8). Neither
/// fails anything if it stops being true — a public read that reused the list row, or grew a field called
/// <c>Tags</c>, would publish somebody's private labels without a word. These fail first (ADR 0065).
/// </para>
/// <para>
/// There is no fallback authorization policy, so an action is reachable anonymously exactly when neither
/// it nor its controller says <c>[Authorize]</c>, or either says <c>[AllowAnonymous]</c>.
/// </para>
/// </remarks>
public class TagPrivacyTests
{
    private static readonly Assembly Server = typeof(ListEntryDto).Assembly;

    private static IEnumerable<(Type Controller, MethodInfo Action)> Actions() =>
        Server.GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract)
            .SelectMany(controller => controller
                .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(action => action.IsDefined(typeof(HttpMethodAttribute), inherit: true))
                .Select(action => (controller, action)));

    private static bool IsAnonymous(Type controller, MethodInfo action) =>
        controller.IsDefined(typeof(AllowAnonymousAttribute), inherit: true)
        || action.IsDefined(typeof(AllowAnonymousAttribute), inherit: true)
        || (!controller.IsDefined(typeof(AuthorizeAttribute), inherit: true)
            && !action.IsDefined(typeof(AuthorizeAttribute), inherit: true));

    /// <summary>
    /// Every type of ours an answer can contain, through its properties, the collections they hold and the
    /// task and action result around them.
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
    public void AnonymousActions_AnswerWithNothingThatCarriesATag()
    {
        var reachable = ReachableFrom(Actions()
            .Where(pair => IsAnonymous(pair.Controller, pair.Action))
            .Select(pair => pair.Action.ReturnType));

        // Not vacuous: the public profile, a game's member reviews and the sitemap are among them.
        Assert.Contains(typeof(PublicProfileDto), reachable);
        Assert.Contains(typeof(GameReviewsDto), reachable);

        Assert.DoesNotContain(typeof(TagDto), reachable);
        Assert.DoesNotContain(typeof(ListEntryDto), reachable);
        Assert.DoesNotContain(typeof(EntryDetailDto), reachable);
        Assert.DoesNotContain(typeof(TagExportDto), reachable);
        Assert.DoesNotContain(typeof(EntryTagExportDto), reachable);

        Assert.Empty(reachable
            .SelectMany(type => type.GetProperties())
            .Where(property => property.Name.Contains("Tag", StringComparison.Ordinal))
            .Select(property => $"{property.DeclaringType!.Name}.{property.Name}"));
    }

    [Fact]
    public void TheWalk_WouldSeeATagIfAnAnonymousActionCarriedOne()
    {
        // The signed-in reads do reach them, so a test above that passed would not be passing because the
        // walk cannot see a tag at all.
        var lists = typeof(ListsController).GetMethod(nameof(ListsController.GetLists))!;
        var tags = typeof(TagsController).GetMethod(nameof(TagsController.GetTags))!;

        Assert.Contains(typeof(ListEntryDto), ReachableFrom([lists.ReturnType]));
        Assert.Contains(typeof(TagDto), ReachableFrom([tags.ReturnType]));
    }

    [Fact]
    public void EveryTagEndpoint_NeedsTheOwnersCookie()
    {
        var anonymous = Actions()
            .Where(pair => pair.Controller == typeof(TagsController)
                || (pair.Controller == typeof(EntriesController) && pair.Action.Name == nameof(EntriesController.SetTags)))
            .Where(pair => IsAnonymous(pair.Controller, pair.Action))
            .Select(pair => pair.Action.Name)
            .ToList();

        Assert.Empty(anonymous);
        Assert.Contains(Actions(), pair => pair.Action.Name == nameof(EntriesController.SetTags));
    }

    [Fact]
    public void TheTagsAnswers_AreNeverStored()
    {
        // One account's tags are nothing for a cache between here and the browser to keep for the next.
        var policy = typeof(TagsController).GetCustomAttribute<ResponseCacheAttribute>();

        Assert.NotNull(policy);
        Assert.True(policy.NoStore);
    }
}
