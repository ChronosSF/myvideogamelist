using System.Net;
using System.Reflection;
using System.Security.Claims;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.Extensions.DependencyInjection;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;

namespace MyVideoGameList.Server.IntegrationTests;

/// <summary>
/// What ADR 0024 could only assert of the model: that deleting an account, or a row other rows of
/// somebody's depend on, takes those rows with it — here in PostgreSQL, through the constraints the
/// migrations created.
/// </summary>
/// <remarks>
/// <para>
/// <c>UserOwnedDataTests</c> declines to delete anything, deliberately: the in-memory provider
/// cascades only to rows its context happens to be tracking, so such a test would pass or fail for
/// reasons that have nothing to do with the database. This is the real one it left for later.
/// </para>
/// <para>
/// Both model walks select tables the way that test does — an entity with a <c>UserId</c> is
/// somebody's data — so a table added later is covered without being named here. What it does have
/// to be is <em>seeded</em>: each walk first insists that the account holds a row in every table it
/// is about to assert on, so a new table nobody wrote a row into fails here, by name, rather than
/// passing on zero rows that were never there.
/// </para>
/// </remarks>
public class OwnershipCascadeTests(ApiFactory api) : IClassFixture<ApiFactory>
{
    private const int Played = 1020;
    private const int Wanted = 1021;

    [Fact]
    public async Task DeleteAccount_WithARowInEveryTable_TakesTheAccountsRowsAndNobodyElses()
    {
        using var leaving = api.CreateBrowser();
        using var staying = api.CreateBrowser();
        var leaver = await RecordEverythingAsync(leaving, "leaver");
        var stayer = await RecordEverythingAsync(staying, "stayer");

        var held = await RowsOwnedByAsync(leaver.Id);
        AssertEveryTableHoldsARow(held);
        var kept = await RowsOwnedByAsync(stayer.Id);

        var delete = await leaving.SendAsync(
            HttpMethod.Delete, "/api/user", new DeleteAccountDto(Browsers.Password));
        await delete.ExpectAsync(HttpStatusCode.NoContent);

        // One DeleteAsync on the account row, and the database does the rest (ADR 0024 §6).
        var left = await RowsOwnedByAsync(leaver.Id);
        Assert.All(left, table => Assert.True(table.Value == 0,
            $"{table.Value} row(s) of {table.Key} outlived the account that owned them."));
        Assert.Equal(kept, await RowsOwnedByAsync(stayer.Id));

        await using var db = api.Database();
        Assert.False(await db.Users.AnyAsync(user => user.Id == leaver.Id));
        Assert.True(await db.Users.AnyAsync(user => user.Id == stayer.Id));

        // Not somebody's data, so not deleted with anybody: the games stay cached for everyone else.
        Assert.Equal(2, await db.CachedGames.CountAsync(game => game.GameId == Played || game.GameId == Wanted));

        // And the browser is signed out. Asked of an endpoint that reads only the cookie's claim:
        // /me would answer 401 for an account that has gone whether or not the cookie had.
        await (await leaving.GetAsync("/api/user/stats")).ExpectAsync(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ExecuteDelete_OnAParentRow_TakesEveryRowThatCannotExistWithoutIt()
    {
        // The other edge, which UserOwnedDataTests asserts of the model and this asserts of the
        // database: a playthrough or a review without its entry, an import row without its job. Each
        // parent is deleted the way the retention sweep deletes jobs — one DELETE, nothing loaded —
        // so only the constraint can take the children (ADR 0038).
        using var browser = api.CreateBrowser();
        var user = await RecordEverythingAsync(browser, "parent");

        await using var db = api.Database();

        var dependents = db.Model.GetEntityTypes()
            .Where(Ours)
            .SelectMany(entity => entity.GetForeignKeys())
            .Where(fk => Ours(fk.PrincipalEntityType) && fk.PrincipalEntityType.FindProperty("UserId") is not null)
            .Where(fk => fk.IsRequired)
            .GroupBy(fk => fk.PrincipalEntityType, fk => fk.DeclaringEntityType)
            .ToList();

        // A tripwire, as UserOwnedDataTests keeps one for the tables: an edge added or taken away
        // fails here first, so the walk below cannot quietly shrink to nothing and pass.
        Assert.Equal(
            [
                (nameof(ImportJob), nameof(ImportRow)),
                (nameof(UserGameEntry), nameof(Review)),
                (nameof(UserGameEntry), nameof(UserGamePlaythrough)),
            ],
            dependents
                .SelectMany(family => family.Distinct().Select(child => (family.Key.ClrType.Name, child.ClrType.Name)))
                .Order());

        foreach (var family in dependents)
        {
            var parent = family.Key;
            var children = family.Distinct().ToList();

            foreach (var child in children)
            {
                Assert.True(await CountOwnedAsync(db, child, user.Id) > 0,
                    $"Record a {child.ClrType.Name} in {nameof(RecordEverythingAsync)}, so that what deleting its "
                    + $"{parent.ClrType.Name} does to it is asserted rather than assumed.");
            }

            await DeleteOwnedAsync(db, parent, user.Id);

            foreach (var child in children)
            {
                Assert.True(await CountOwnedAsync(db, child, user.Id) == 0,
                    $"Deleting every {parent.ClrType.Name} left {child.ClrType.Name} rows behind.");
            }
        }
    }

    [Fact]
    public async Task DeleteEntry_WithAPlaythroughAndAReview_TakesBothAndKeepsTheLog()
    {
        using var browser = api.CreateBrowser();
        await RecordEverythingAsync(browser, "forgetter");

        var delete = await browser.SendAsync(HttpMethod.Delete, $"/api/entries/{Played}");
        await delete.ExpectAsync(HttpStatusCode.NoContent);

        await (await browser.GetAsync($"/api/entries/{Played}")).ExpectAsync(HttpStatusCode.NotFound);

        var export = await browser.GetJsonAsync<UserDataExportDto>("/api/user/export");
        Assert.DoesNotContain(export.Entries, entry => entry.GameId == Played);
        Assert.Empty(export.Playthroughs);
        Assert.Empty(export.Reviews);

        // The log is a record of what the user did, so it outlives the entry, and the deletion
        // itself is in it as a move to no list (ADR 0018).
        Assert.Equal(
            [(null, ListStatusKeys.Finished), (ListStatusKeys.Finished, null)],
            export.Events.Where(e => e.GameId == Played).Select(e => (e.FromStatus, e.ToStatus)));
    }

    [Fact]
    public async Task DeletePlaythrough_ThatTheReviewDescribes_KeepsTheReviewAndUnlinksIt()
    {
        // An optional pointer between siblings, which must not cascade: deleting the record of one
        // run is not deleting what was written about the game. SET NULL in the database, with
        // nothing in the context to do it instead.
        using var browser = api.CreateBrowser();
        var recorded = await RecordEverythingAsync(browser, "rewriter");

        // The pointer is there to begin with, or deleting the run would prove nothing about it.
        var linked = await browser.GetJsonAsync<EntryDetailDto>($"/api/entries/{Played}");
        Assert.Equal(recorded.PlaythroughId, linked.Review?.PlaythroughId);

        var delete = await browser.SendAsync(
            HttpMethod.Delete, $"/api/entries/{Played}/playthroughs/{recorded.PlaythroughId}");
        await delete.ExpectAsync(HttpStatusCode.NoContent);

        var entry = await browser.GetJsonAsync<EntryDetailDto>($"/api/entries/{Played}");
        Assert.Empty(entry.Playthroughs);
        Assert.NotNull(entry.Review);
        Assert.Null(entry.Review.PlaythroughId);
    }

    /// <summary>The account and the playthrough a review was written about.</summary>
    private sealed record Recorded(string Id, int PlaythroughId);

    /// <summary>
    /// Registers an account and gives it at least one row in every table that carries a
    /// <c>UserId</c> — through the API wherever an endpoint writes one, and through Identity's own
    /// manager for the tables only Identity writes.
    /// </summary>
    private async Task<Recorded> RecordEverythingAsync(HttpClient browser, string prefix)
    {
        await api.CacheGamesAsync(Played, Wanted);
        var profile = await browser.RegisterAsync(Browsers.NewUserName(prefix));

        async Task Write(HttpMethod method, string path, object? body = null)
        {
            var response = await browser.SendAsync(method, path, body);
            if (response.StatusCode is not (HttpStatusCode.OK or HttpStatusCode.NoContent or HttpStatusCode.Created))
                await response.ExpectAsync(HttpStatusCode.OK);
        }

        // UserGameEntries, UserGameEvents.
        await Write(HttpMethod.Put, $"/api/lists/{Played}", new SetListEntryDto(ListStatusKeys.Finished));

        // UserGamePlaythroughs.
        var added = await browser.SendAsync(HttpMethod.Post, $"/api/entries/{Played}/playthroughs",
            new PlaythroughInputDto(PlaythroughTypeKeys.Normally, 6, 600,
                new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 20), "One run."));
        var playthrough = await added.ReadAsync<PlaythroughDto>(HttpStatusCode.Created);

        // Reviews, written about that run.
        await Write(HttpMethod.Put, $"/api/entries/{Played}/review",
            new ReviewInputDto("Worth it.", false, ReviewVisibility.Private, playthrough.Id));

        // UserWishlistItems, UserFavourites.
        await Write(HttpMethod.Put, $"/api/wishlist/{Wanted}");
        await Write(HttpMethod.Put, $"/api/favourites/{Played}");

        // UserListSortPreferences, UserListSettings.
        await Write(HttpMethod.Put, "/api/user/list-preferences", new UpdateListPreferencesDto(
            ListViewModes.Table, [new ListSortPreferenceDto(ListStatusKeys.Backlog, ListSortKeys.Title, false)]));
        await Write(HttpMethod.Put, "/api/user/list-names",
            new UpdateListNamesDto([new ListNameInputDto(ListStatusKeys.Backlog, "Pile of shame")]));

        // ImportJobs, ImportRows: a pending job, whose rows are kept until it closes (ADR 0039).
        await browser.UploadGrouveeAsync(Played, Wanted);

        // AspNetUserClaims, AspNetUserLogins, AspNetUserTokens, AspNetUserRoles: Identity's, but
        // somebody's all the same, and deleted with the account by the same means.
        await using var scope = api.Services.CreateAsyncScope();
        var users = scope.ServiceProvider.GetRequiredService<UserManager<ApplicationUser>>();
        var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole>>();
        var user = await users.FindByIdAsync(profile.Id) ?? throw new InvalidOperationException("No account.");

        if (!await roles.RoleExistsAsync("tester"))
            Succeeded(await roles.CreateAsync(new IdentityRole("tester")));

        Succeeded(await users.AddClaimAsync(user, new Claim("test", "claim")));
        Succeeded(await users.AddLoginAsync(user, new UserLoginInfo("test", $"key-{user.Id}", "Test")));
        Succeeded(await users.SetAuthenticationTokenAsync(user, "test", "token", "value"));
        Succeeded(await users.AddToRoleAsync(user, "tester"));

        return new Recorded(profile.Id, playthrough.Id);
    }

    private static void Succeeded(IdentityResult result) =>
        Assert.True(result.Succeeded, string.Join(" ", result.Errors.Select(error => error.Description)));

    /// <summary>
    /// How many rows the account owns in each table carrying a <c>UserId</c>, Identity's included,
    /// by table name.
    /// </summary>
    private async Task<SortedDictionary<string, int>> RowsOwnedByAsync(string userId)
    {
        await using var db = api.Database();
        var counts = new SortedDictionary<string, int>();

        foreach (var entity in db.Model.GetEntityTypes().Where(entity => entity.FindProperty("UserId") is not null))
            counts[entity.GetTableName() ?? entity.Name] = await CountOwnedAsync(db, entity, userId);

        return counts;
    }

    private static void AssertEveryTableHoldsARow(SortedDictionary<string, int> held) =>
        Assert.All(held, table => Assert.True(table.Value > 0,
            $"Record a row of {table.Key} in {nameof(RecordEverythingAsync)}, so that deleting the account "
            + "is shown to take it rather than assumed to."));

    private static bool Ours(IReadOnlyTypeBase entity) =>
        entity.ClrType.Assembly == typeof(UserGameEntry).Assembly;

    private static Task<int> CountOwnedAsync(ApplicationDbContext db, IEntityType entity, string userId) =>
        (Task<int>)Generic(nameof(CountAsync), entity).Invoke(null, [db, userId])!;

    private static Task DeleteOwnedAsync(ApplicationDbContext db, IEntityType entity, string userId) =>
        (Task)Generic(nameof(DeleteAsync), entity).Invoke(null, [db, userId])!;

    private static MethodInfo Generic(string name, IEntityType entity) =>
        typeof(OwnershipCascadeTests)
            .GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static)!
            .MakeGenericMethod(entity.ClrType);

    private static Task<int> CountAsync<TEntity>(ApplicationDbContext db, string userId) where TEntity : class =>
        db.Set<TEntity>().CountAsync(row => EF.Property<string>(row, "UserId") == userId);

    private static Task<int> DeleteAsync<TEntity>(ApplicationDbContext db, string userId) where TEntity : class =>
        db.Set<TEntity>().Where(row => EF.Property<string>(row, "UserId") == userId).ExecuteDeleteAsync();
}
