using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// Who may use the admin page: account ids, from configuration.
/// </summary>
/// <remarks>
/// <para>
/// Ids because they never change. A username can be renamed by its owner
/// (<c>docs/decisions/0027-*</c>), so a privilege keyed on one would pass to whoever claimed the name
/// next; an address can be changed too, and does not belong in a deployment's environment.
/// </para>
/// <para>
/// Configuration rather than Identity's role tables, although <c>Program.cs</c> registers
/// <see cref="IdentityRole"/>: a role still needs its first member put there by some means, and on a
/// database with no public endpoint (<c>docs/decisions/0015-*</c>) that means configuration anyway.
/// Roles become worth having with a second kind of admin (spec §7).
/// </para>
/// </remarks>
public sealed class AdminOptions
{
    public const string Section = "Admin";

    public string[] AccountIds { get; set; } = [];
}

/// <summary>
/// The one answer to "is this account an admin", asked by the policy and by <c>/api/auth/me</c>, so
/// the navbar's link and the server's refusal cannot disagree about anybody.
/// </summary>
/// <remarks>
/// Alike in every environment, and deliberately unlike the statistics tiers' stand-in
/// (<c>specs/profile-statistics-tiers.md</c> §4), which grants everything in Development. That one
/// withholds figures, so granting them all locally only makes local work easier. This one guards
/// writes, and a local default that let everybody in would mean the refusal was never once exercised
/// where the page is built.
/// </remarks>
public sealed class AdminAccounts(IOptionsMonitor<AdminOptions> options)
{
    public bool IsAdmin(string? accountId) =>
        !string.IsNullOrEmpty(accountId)
        && options.CurrentValue.AccountIds.Contains(accountId, StringComparer.Ordinal);
}

/// <summary>What the admin policy requires. It holds nothing: the list is configuration.</summary>
public sealed class AdminRequirement : IAuthorizationRequirement;

/// <summary>Satisfied by a signed-in account <see cref="AdminAccounts"/> names, and by nothing else.</summary>
public sealed class AdminHandler(AdminAccounts admins, IOptions<IdentityOptions> identity)
    : AuthorizationHandler<AdminRequirement>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        AdminRequirement requirement)
    {
        // The claim Identity itself reads the account id from, rather than a hardcoded claim type,
        // so the two cannot come apart if Identity is ever configured differently.
        var accountId = context.User.FindFirstValue(identity.Value.ClaimsIdentity.UserIdClaimType);

        if (admins.IsAdmin(accountId)) context.Succeed(requirement);
        return Task.CompletedTask;
    }
}

/// <summary>
/// The policy every admin endpoint sits behind (spec §7, A1 and A2).
/// </summary>
/// <remarks>
/// The client shows the admin page's link only to an admin, and that is presentation. This is the
/// guard: a request from anybody else is refused here whether or not they found the page.
/// </remarks>
public static class AdminPolicy
{
    public const string Name = "admin";

    public static IServiceCollection AddAdminPolicy(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<AdminOptions>(configuration.GetSection(AdminOptions.Section));
        services.AddSingleton<AdminAccounts>();
        services.AddSingleton<IAuthorizationHandler, AdminHandler>();

        // Authenticated first, so a caller who is not signed in is told to sign in (401) and one who
        // is signed in but not named is refused (403), rather than both getting the same answer.
        services.AddAuthorizationBuilder()
            .AddPolicy(Name, policy => policy
                .RequireAuthenticatedUser()
                .AddRequirements(new AdminRequirement()));

        return services;
    }
}
