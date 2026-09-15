using Microsoft.EntityFrameworkCore;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What a user may call their lists, and what a rename may never do — change what a list means.
/// See <c>docs/data-model-plan.md</c>, decision 8, and ADR 0031.
/// </summary>
public class ListNameServiceTests
{
    private const string UserId = "user-1";
    private const string OtherUserId = "user-2";

    /// <summary><c>EnsureCreated</c> seeds the five real statuses, with their real default names.</summary>
    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    private static ListNameInputDto Name(string status, string? name) => new(status, name);

    private static Task<ListNamesResult> Save(ApplicationDbContext db, params ListNameInputDto[] names) =>
        new ListNameService(db).ReplaceAsync(UserId, names);

    [Fact]
    public async Task ReplaceAsync_ARename_IsStoredAndReadBackByKey()
    {
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.Finished, "Beaten"));

        Assert.True(result.Succeeded);
        Assert.Equal("Beaten", result.Names![ListStatusKeys.Finished]);
        Assert.Equal(
            new Dictionary<string, string> { [ListStatusKeys.Finished] = "Beaten" },
            await new ListNameService(db).GetNamesAsync(UserId));
    }

    [Fact]
    public async Task ReplaceAsync_ChangesNothingAboutTheStatus()
    {
        // Decision 8: a rename is a label. The flags every statistic keys on are untouched, and the
        // lookup is not written to at all.
        using var db = NewDb();
        var before = await db.ListStatuses.AsNoTracking().OrderBy(s => s.Id).ToListAsync();

        await Save(db, Name(ListStatusKeys.Finished, "Dropped for good"));

        var after = await db.ListStatuses.AsNoTracking().OrderBy(s => s.Id).ToListAsync();
        Assert.Equal(
            before.Select(s => (s.Key, s.DefaultName, s.IsStarted, s.IsTerminal, s.CountsAsCompletion)),
            after.Select(s => (s.Key, s.DefaultName, s.IsStarted, s.IsTerminal, s.CountsAsCompletion)));
    }

    [Fact]
    public async Task ReplaceAsync_NormalisesWhitespace()
    {
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.Backlog, "  Pile   of\tShame  "));

        Assert.Equal("Pile of Shame", result.Names![ListStatusKeys.Backlog]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("Finished")]
    public async Task ReplaceAsync_BlankOrTheDefault_PutsTheListBack(string? name)
    {
        // No row is the default. Storing "Finished" for Finished would be a copy of the default that
        // stops tracking it.
        using var db = NewDb();
        await Save(db, Name(ListStatusKeys.Finished, "Beaten"));

        var result = await Save(db, Name(ListStatusKeys.Finished, name));

        Assert.True(result.Succeeded);
        Assert.Empty(result.Names!);
        Assert.Empty(await db.UserListSettings.ToListAsync());
    }

    [Fact]
    public async Task ReplaceAsync_TheDefaultInAnotherCase_IsARename()
    {
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.Finished, "FINISHED"));

        Assert.Equal("FINISHED", result.Names![ListStatusKeys.Finished]);
    }

    [Fact]
    public async Task ReplaceAsync_ReplacesTheWholeSet()
    {
        // A list left out goes back to its default, as a sort left out does.
        using var db = NewDb();
        await Save(db, Name(ListStatusKeys.Backlog, "Someday"), Name(ListStatusKeys.Dropped, "Nope"));

        await Save(db, Name(ListStatusKeys.Backlog, "Someday, maybe"));

        Assert.Equal(
            new Dictionary<string, string> { [ListStatusKeys.Backlog] = "Someday, maybe" },
            await new ListNameService(db).GetNamesAsync(UserId));
    }

    [Fact]
    public async Task ReplaceAsync_SavingTheSameNamesAgain_Succeeds()
    {
        // The rows are removed and re-added with the same keys in one save, which is the case most
        // likely to trip the change tracker.
        using var db = NewDb();
        await Save(db, Name(ListStatusKeys.Playing, "Now"));

        var again = await Save(db, Name(ListStatusKeys.Playing, "Now"));

        Assert.True(again.Succeeded);
        Assert.Single(await db.UserListSettings.ToListAsync());
    }

    [Fact]
    public async Task ReplaceAsync_TooLong_IsRefusedBesideThatList()
    {
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.OnHold, new string('x', ListNamePolicy.MaxLength + 1)));

        Assert.False(result.Succeeded);
        Assert.Contains("at most", result.Errors[ListStatusKeys.OnHold]);
    }

    [Fact]
    public async Task ReplaceAsync_ControlCharacters_AreRefused()
    {
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.OnHold, "Paused"));

        Assert.False(result.Succeeded);
        Assert.Contains("control characters", result.Errors[ListStatusKeys.OnHold]);
    }

    [Fact]
    public async Task ReplaceAsync_ANameAnotherListHasByDefault_IsRefused()
    {
        // Two buttons both reading "Playing" — one of them Dropped — could not be told apart. The
        // message goes to the list that was renamed, never to the default nobody typed.
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.Dropped, "playing"));

        Assert.False(result.Succeeded);
        Assert.Contains("already called", result.Errors[ListStatusKeys.Dropped]);
        Assert.False(result.Errors.ContainsKey(ListStatusKeys.Playing));
    }

    [Fact]
    public async Task ReplaceAsync_TwoRenamesToOneName_AreBothRefused()
    {
        using var db = NewDb();

        var result = await Save(db, Name(ListStatusKeys.Backlog, "Later"), Name(ListStatusKeys.OnHold, "LATER"));

        Assert.False(result.Succeeded);
        Assert.True(result.Errors.ContainsKey(ListStatusKeys.Backlog));
        Assert.True(result.Errors.ContainsKey(ListStatusKeys.OnHold));
    }

    [Fact]
    public async Task ReplaceAsync_SwappingTwoNames_IsAllowed()
    {
        // Uniqueness is judged on the set being saved, not against what is stored: calling Playing
        // "Finished" is fine once Finished is being called something else in the same save.
        using var db = NewDb();

        var result = await Save(db,
            Name(ListStatusKeys.Playing, "Finished"),
            Name(ListStatusKeys.Finished, "Playing"));

        Assert.True(result.Succeeded);
    }

    [Fact]
    public async Task ReplaceAsync_ARefusedSave_LeavesTheOldNamesAlone()
    {
        using var db = NewDb();
        await Save(db, Name(ListStatusKeys.Finished, "Beaten"));

        await Save(db, Name(ListStatusKeys.Finished, "Done"), Name(ListStatusKeys.Dropped, "done"));

        Assert.Equal("Beaten", (await db.UserListSettings.SingleAsync()).DisplayName);
    }

    [Fact]
    public async Task Names_AreScopedToTheirOwner()
    {
        using var db = NewDb();
        await Save(db, Name(ListStatusKeys.Finished, "Beaten"));
        await new ListNameService(db).ReplaceAsync(OtherUserId, [Name(ListStatusKeys.Finished, "Cleared")]);

        await Save(db);

        Assert.Empty(await new ListNameService(db).GetNamesAsync(UserId));
        Assert.Equal("Cleared", (await new ListNameService(db).GetNamesAsync(OtherUserId))[ListStatusKeys.Finished]);
    }
}
