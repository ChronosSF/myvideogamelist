using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Controllers;
using MyVideoGameList.Server.Security;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Who gets through the admin policy (<c>specs/release-timeline-and-calendar.md</c> §7, A1 and A2).
/// </summary>
/// <remarks>
/// Asked of the application's own registration, <see cref="AdminPolicy.AddAdminPolicy"/>, rather than
/// of a handler built by hand, for the reason <c>AddScheduledWork</c>'s tests give: a policy assembled
/// in the test pins what the test assembled and nothing about what <c>Program.cs</c> does.
/// </remarks>
public class AdminPolicyTests
{
    private const string AdminId = "8c0e2a4b-1d3f-4e5a-9b7c-6d8e0f1a2b3c";
    private const string OtherId = "3f2e1d0c-9b8a-4765-8432-10fedcba9876";

    private static IAuthorizationService Policy(params string[] adminIds)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(adminIds.Select((id, i) =>
                new KeyValuePair<string, string?>($"Admin:AccountIds:{i}", id)))
            .Build();

        return new ServiceCollection()
            .AddLogging()
            .AddAdminPolicy(configuration)
            .BuildServiceProvider()
            .GetRequiredService<IAuthorizationService>();
    }

    /// <summary>A signed-in account, carrying its id and its username as Identity's cookie does.</summary>
    private static ClaimsPrincipal SignedIn(string accountId, string userName = "someone") =>
        new(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, accountId), new Claim(ClaimTypes.Name, userName)],
            authenticationType: "Identity.Application"));

    private static async Task<bool> Allows(IAuthorizationService policy, ClaimsPrincipal user) =>
        (await policy.AuthorizeAsync(user, AdminPolicy.Name)).Succeeded;

    [Fact]
    public async Task AdminPolicy_AnAccountNamedInConfiguration_IsLetThrough()
    {
        Assert.True(await Allows(Policy(AdminId), SignedIn(AdminId)));
    }

    [Fact]
    public async Task AdminPolicy_ASignedInAccountNotNamed_IsRefused()
    {
        Assert.False(await Allows(Policy(AdminId), SignedIn(OtherId)));
    }

    [Fact]
    public async Task AdminPolicy_WithNobodyNamed_RefusesEverybody()
    {
        // The default in appsettings.json, and the same in every environment: unlike the statistics
        // tiers' stand-in there is no Development grant, so nobody is an admin until somebody is named.
        Assert.False(await Allows(Policy(), SignedIn(AdminId)));
    }

    [Fact]
    public async Task AdminPolicy_ASignedOutCaller_IsRefused()
    {
        Assert.False(await Allows(Policy(AdminId), new ClaimsPrincipal(new ClaimsIdentity())));
    }

    [Fact]
    public async Task AdminPolicy_AUsernameInTheList_GrantsNothing()
    {
        // A1: the list holds account ids, because a username can be given up and claimed by somebody
        // else. A name that found its way into the list must not work as one.
        Assert.False(await Allows(Policy("alice"), SignedIn(OtherId, userName: "alice")));
    }

    [Fact]
    public void CalendarAdminController_EveryAction_IsBehindTheAdminPolicy()
    {
        // A2. The policy is on the class so that an action added later is guarded without anybody
        // remembering to guard it; [AllowAnonymous] on any one of them would undo that silently.
        var controller = typeof(CalendarAdminController);

        Assert.Contains(
            controller.GetCustomAttributes<AuthorizeAttribute>(),
            attribute => attribute.Policy == AdminPolicy.Name);

        var anonymous = controller
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Where(action => action.GetCustomAttribute<AllowAnonymousAttribute>() is not null)
            .Select(action => action.Name);

        Assert.Empty(anonymous);
    }
}
