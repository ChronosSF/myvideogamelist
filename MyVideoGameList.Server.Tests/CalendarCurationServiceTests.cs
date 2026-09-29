using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.DTOs;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.Tests;

public class CalendarCurationServiceTests
{
    private static readonly DateTimeOffset Midday = new(2026, 9, 29, 12, 0, 0, TimeSpan.Zero);

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

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

    private static ApplicationDbContext NewDb(string store, IInterceptor? interceptor = null)
    {
        var options = new DbContextOptionsBuilder<ApplicationDbContext>().UseInMemoryDatabase(store);
        if (interceptor is not null) options.AddInterceptors(interceptor);
        return new ApplicationDbContext(options.Options);
    }

    private static CuratedEventInputDto Input(
        string name = "Steam Autumn Sale",
        DateOnly? startsOn = null,
        DateOnly? endsOn = null,
        string url = "https://partner.steamgames.com/doc/marketing/upcoming_events",
        string kind = CuratedEventKinds.Sale,
        string? store = CuratedEventStores.Steam) =>
        new(kind, store, name, startsOn ?? new DateOnly(2026, 10, 1), endsOn ?? new DateOnly(2026, 10, 8), url);

    [Fact]
    public async Task AddEventAsync_TidiesWhatWasPastedAndStampsBothTimes()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));

        var added = await service.AddEventAsync(Input(
            name: "  Steam   Autumn\nSale ",
            url: " https://store.steampowered.com/news/ "));

        var stored = await db.CuratedEvents.SingleAsync();
        Assert.Equal("Steam Autumn Sale", stored.Name);
        Assert.Equal("https://store.steampowered.com/news/", stored.Url);
        Assert.Equal(Midday, stored.CreatedAt);
        Assert.Equal(Midday, stored.UpdatedAt);
        Assert.Equal(stored.Id, added.Id);
    }

    [Fact]
    public async Task ReplaceEventAsync_KeepsWhenItWasAddedAndMovesWhenItChanged()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var clock = new ManualClock(Midday);
        var service = new CalendarCurationService(db, clock);
        var added = await service.AddEventAsync(Input());

        clock.Now = Midday.AddDays(2);
        var replaced = await service.ReplaceEventAsync(
            added.Id,
            Input(name: "Steam Winter Sale", startsOn: new DateOnly(2026, 12, 17), endsOn: new DateOnly(2027, 1, 4)));

        Assert.NotNull(replaced);
        var stored = await db.CuratedEvents.SingleAsync();
        Assert.Equal("Steam Winter Sale", stored.Name);
        Assert.Equal(new DateOnly(2027, 1, 4), stored.EndsOn);
        Assert.Equal(Midday, stored.CreatedAt);
        Assert.Equal(Midday.AddDays(2), stored.UpdatedAt);
    }

    [Fact]
    public async Task ReplaceEventAsync_AnEventThatIsNotThere_IsNull()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));

        Assert.Null(await service.ReplaceEventAsync(41, Input()));
    }

    [Fact]
    public async Task ReplaceEventAsync_AnEventRemovedWhileItWasBeingEdited_IsNullRatherThanThrowing()
    {
        var store = Guid.NewGuid().ToString();
        int id;
        using (var seed = NewDb(store))
        {
            id = (await new CalendarCurationService(seed, new ManualClock(Midday)).AddEventAsync(Input())).Id;
        }

        using var otherTab = NewDb(store);
        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherTab.CuratedEvents.Remove(await otherTab.CuratedEvents.SingleAsync());
            await otherTab.SaveChangesAsync();
        }));

        // A real edit: replacing an event with what it already holds is no change, and EF writes
        // nothing for it at all.
        var edit = Input(name: "Steam Autumn Sale 2026");

        Assert.Null(await new CalendarCurationService(db, new ManualClock(Midday)).ReplaceEventAsync(id, edit));
    }

    [Fact]
    public async Task RemoveEventAsync_RemovesItOnceAndThenReportsNothingToRemove()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));
        var added = await service.AddEventAsync(Input());

        Assert.True(await service.RemoveEventAsync(added.Id));
        Assert.False(await service.RemoveEventAsync(added.Id));
        Assert.Empty(db.CuratedEvents);
    }

    [Fact]
    public async Task RemoveEventAsync_ADeleteClickedTwice_ReportsNothingToRemoveRatherThanThrowing()
    {
        var store = Guid.NewGuid().ToString();
        int id;
        using (var seed = NewDb(store))
        {
            id = (await new CalendarCurationService(seed, new ManualClock(Midday)).AddEventAsync(Input())).Id;
        }

        using var firstClick = NewDb(store);
        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            firstClick.CuratedEvents.Remove(await firstClick.CuratedEvents.SingleAsync());
            await firstClick.SaveChangesAsync();
        }));

        Assert.False(await new CalendarCurationService(db, new ManualClock(Midday)).RemoveEventAsync(id));
    }

    [Fact]
    public async Task ListEventsAsync_IsEveryEventEarliestFirst()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));
        await service.AddEventAsync(Input(name: "Steam Winter Sale", startsOn: new DateOnly(2026, 12, 17), endsOn: new DateOnly(2027, 1, 4)));
        await service.AddEventAsync(Input(name: "Steam Summer Sale", startsOn: new DateOnly(2026, 6, 25), endsOn: new DateOnly(2026, 7, 9)));
        await service.AddEventAsync(Input(name: "Steam Autumn Sale"));

        var listed = await service.ListEventsAsync();

        // Past events included: the admin page decides what to show, and nothing is deleted by age.
        Assert.Equal(
            ["Steam Summer Sale", "Steam Autumn Sale", "Steam Winter Sale"],
            listed.Select(e => e.Name));
    }

    [Fact]
    public async Task AddShowcaseNameAsync_TheSameNameInAnotherCase_IsAlreadyListed()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));

        Assert.NotNull(await service.AddShowcaseNameAsync("Nintendo Direct"));
        Assert.Null(await service.AddShowcaseNameAsync("nintendo direct"));
        Assert.Single(db.ShowcaseNames);
    }

    [Fact]
    public async Task AddShowcaseNameAsync_TidiesTheName()
    {
        // A trailing space would make the prefix stop matching the show it names.
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));

        var added = await service.AddShowcaseNameAsync("  State of   Play ");

        Assert.Equal("State of Play", added?.Prefix);
    }

    [Fact]
    public async Task AddShowcaseNameAsync_LosingTheInsertRace_IsAlreadyListedRatherThanThrowing()
    {
        // Raised by hand, as in the favourites' race tests: the in-memory provider enforces no unique
        // index, so it never produces the DbUpdateException PostgreSQL's would become.
        var store = Guid.NewGuid().ToString();
        using var otherRequest = NewDb(store);

        using var db = NewDb(store, new CommitsCompetingWrite(async () =>
        {
            otherRequest.ShowcaseNames.Add(new ShowcaseName { Prefix = "Summer Game Fest" });
            await otherRequest.SaveChangesAsync();
            throw new DbUpdateException("duplicate key value violates unique constraint");
        }));

        Assert.Null(await new CalendarCurationService(db, new ManualClock(Midday)).AddShowcaseNameAsync("Summer Game Fest"));
    }

    [Fact]
    public async Task AddShowcaseNameAsync_WhenTheSaveFailsForAnyOtherReason_StillThrows()
    {
        using var db = NewDb(Guid.NewGuid().ToString(), new CommitsCompetingWrite(() =>
            throw new DbUpdateException("disk on fire")));

        await Assert.ThrowsAsync<DbUpdateException>(() =>
            new CalendarCurationService(db, new ManualClock(Midday)).AddShowcaseNameAsync("The Game Awards"));
    }

    [Fact]
    public async Task ListShowcaseNamesAsync_IsAlphabetical()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));
        await service.AddShowcaseNameAsync("Xbox Games Showcase");
        await service.AddShowcaseNameAsync("Nintendo Direct");

        Assert.Equal(
            ["Nintendo Direct", "Xbox Games Showcase"],
            (await service.ListShowcaseNamesAsync()).Select(n => n.Prefix));
    }

    [Fact]
    public async Task RemoveShowcaseNameAsync_RemovesItOnceAndThenReportsNothingToRemove()
    {
        using var db = NewDb(Guid.NewGuid().ToString());
        var service = new CalendarCurationService(db, new ManualClock(Midday));
        var added = await service.AddShowcaseNameAsync("Nintendo Direct");

        Assert.True(await service.RemoveShowcaseNameAsync(added!.Id));
        Assert.False(await service.RemoveShowcaseNameAsync(added.Id));
    }

    [Fact]
    public void Validate_ALastDayBeforeTheFirst_IsRefusedOnTheLastDay()
    {
        var input = Input(startsOn: new DateOnly(2026, 10, 8), endsOn: new DateOnly(2026, 10, 1));

        var problem = Assert.Single(input.Validate(new ValidationContext(input)));
        Assert.Equal([nameof(CuratedEventInputDto.EndsOn)], problem.MemberNames);
    }

    [Fact]
    public void Validate_AOneDayEvent_IsFine()
    {
        var day = new DateOnly(2026, 11, 27);
        var input = Input(startsOn: day, endsOn: day);

        Assert.Empty(input.Validate(new ValidationContext(input)));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("ftp://example.com/sale")]
    [InlineData("store.steampowered.com/sale")]
    [InlineData("not a link")]
    public void Validate_ALinkThatIsNotAWebAddress_IsRefused(string url)
    {
        // The calendar is shown to everybody, so an address it renders as a link has to be one a link
        // can safely point at — javascript: above all.
        var input = Input(url: url);

        var problem = Assert.Single(input.Validate(new ValidationContext(input)));
        Assert.Equal([nameof(CuratedEventInputDto.Url)], problem.MemberNames);
    }
}
