using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What happens when two accounts claim the same username at once.
/// </summary>
/// <remarks>
/// <para>
/// Identity checks availability with a read before the write, so the ordinary "taken" never reaches
/// the database. Two requests that both pass that read do reach it, and the unique index refuses the
/// second — as a <see cref="DbUpdateException"/> from the store, not as an
/// <see cref="IdentityResult"/>. These pin the translation of that exception into the
/// <c>DuplicateUserName</c> error the read would have produced, and that nothing else is translated.
/// </para>
/// <para>
/// The interleaving has to land after Identity's own read and before its write, which is exactly
/// where a <see cref="SaveChangesInterceptor"/> runs; the shape is <c>WishlistRaceTests</c>'. The
/// exception is raised by the interceptor because the in-memory provider enforces no unique index.
/// The service confirms the race by re-reading rather than by inspecting the exception, so it is
/// that confirmation under test and not any one provider's choice of error.
/// </para>
/// </remarks>
public class UserNameClaimServiceTests
{
    private const string Password = "Password1!";

    /// <summary>Runs another request's write once, inside the first SaveChanges of this context.</summary>
    private sealed class CommitsCompetingWrite(Func<Task> competingWrite) : SaveChangesInterceptor
    {
        private bool _fired;

        public override async ValueTask<InterceptionResult<int>> SavingChangesAsync(
            DbContextEventData eventData,
            InterceptionResult<int> result,
            CancellationToken cancellationToken = default)
        {
            if (!_fired)
            {
                _fired = true;
                await competingWrite();
            }
            return result;
        }
    }

    /// <summary>
    /// One request's worth of Identity: a real <see cref="UserManager{TUser}"/> over the in-memory
    /// store, with the username alphabet <c>Program.cs</c> configures. A substitute would not run
    /// the validator whose read is half of the race.
    /// </summary>
    private static ServiceProvider Request(string store, IInterceptor? interceptor = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<ApplicationDbContext>(options =>
        {
            options.UseInMemoryDatabase(store);
            if (interceptor is not null) options.AddInterceptors(interceptor);
        });
        services
            .AddIdentityCore<ApplicationUser>(options =>
                options.User.AllowedUserNameCharacters = UserNamePolicy.AllowedCharacters)
            .AddEntityFrameworkStores<ApplicationDbContext>();
        services.AddScoped<UserNameClaimService>();
        return services.BuildServiceProvider();
    }

    private static ApplicationUser NewUser(string userName) =>
        new() { UserName = userName, Email = $"{userName}@test.local" };

    private static UserManager<ApplicationUser> Manager(ServiceProvider request) =>
        request.GetRequiredService<UserManager<ApplicationUser>>();

    private static UserNameClaimService Service(ServiceProvider request) =>
        request.GetRequiredService<UserNameClaimService>();

    private static async Task Registered(ServiceProvider request, string userName)
    {
        var created = await Manager(request).CreateAsync(NewUser(userName), Password);
        Assert.True(created.Succeeded, string.Join(" ", created.Errors.Select(e => e.Description)));
    }

    private static DbUpdateException IndexViolation() =>
        new("duplicate key value violates unique constraint \"UserNameIndex\"");

    private static void AssertTaken(IdentityResult result)
    {
        Assert.False(result.Succeeded);
        Assert.Contains(result.Errors,
            e => e.Code == nameof(IdentityErrorDescriber.DuplicateUserName));
    }

    [Fact]
    public async Task RegisterAsync_LosingTheNameRace_ReportsDuplicateUserNameRatherThanThrowing()
    {
        var store = Guid.NewGuid().ToString();
        using var winner = Request(store);
        using var loser = Request(store, new CommitsCompetingWrite(async () =>
        {
            // The other registration lands between this one's validator read and its write.
            await Registered(winner, "alex");
            throw IndexViolation();
        }));

        var result = await Service(loser).RegisterAsync(NewUser("alex"), Password);

        AssertTaken(result);
    }

    [Fact]
    public async Task RegisterAsync_NameTakenBeforeTheRead_IsRefusedWithoutAWrite()
    {
        // The ordinary case, for contrast: Identity's own read catches it, in either case, and no
        // write is attempted at all.
        var store = Guid.NewGuid().ToString();
        using var first = Request(store);
        await Registered(first, "alex");

        var writes = 0;
        using var second = Request(store, new CommitsCompetingWrite(() =>
        {
            writes++;
            return Task.CompletedTask;
        }));

        var result = await Service(second).RegisterAsync(NewUser("Alex"), Password);

        AssertTaken(result);
        Assert.Equal(0, writes);
    }

    [Fact]
    public async Task RegisterAsync_WhenTheWriteFailsForAnyOtherReason_StillThrows()
    {
        // One specific race is translated, not every write failure: a save that fails with the
        // name still free has to surface, or a genuine fault reads as "that username is taken".
        var store = Guid.NewGuid().ToString();
        using var request = Request(store, new CommitsCompetingWrite(() =>
            throw new DbUpdateException("disk on fire")));

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            Service(request).RegisterAsync(NewUser("alex"), Password));
    }

    [Fact]
    public async Task RenameAsync_LosingTheNameRace_ReportsDuplicateUserNameRatherThanThrowing()
    {
        var store = Guid.NewGuid().ToString();
        using var seed = Request(store);
        await Registered(seed, "alex");
        using var winner = Request(store);

        using var loser = Request(store, new CommitsCompetingWrite(async () =>
        {
            await Registered(winner, "sam");
            throw IndexViolation();
        }));
        var alex = await Manager(loser).FindByNameAsync("alex");
        Assert.NotNull(alex);

        var result = await Service(loser).RenameAsync(alex, "sam");

        AssertTaken(result);
    }

    [Fact]
    public async Task RenameAsync_WhenTheWriteFailsWithTheNameStillFree_StillThrows()
    {
        var store = Guid.NewGuid().ToString();
        using var seed = Request(store);
        await Registered(seed, "alex");

        using var request = Request(store, new CommitsCompetingWrite(() =>
            throw new DbUpdateException("disk on fire")));
        var alex = await Manager(request).FindByNameAsync("alex");
        Assert.NotNull(alex);

        await Assert.ThrowsAsync<DbUpdateException>(() => Service(request).RenameAsync(alex, "sam"));
    }
}
