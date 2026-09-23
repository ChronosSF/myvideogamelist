using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Hosting;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services.Import;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which jobs the retention sweep selects.
/// </summary>
/// <remarks>
/// <para>
/// The predicate is run here as a query, exactly as the sweep runs it, rather than being restated
/// as a plain function of two dates. That is the point of it being an <c>Expression</c>: a test
/// that reimplemented the rule would agree with itself and not with the thing that deletes rows.
/// </para>
/// <para>
/// What is deliberately <em>not</em> covered is the deletion: <c>ExecuteDeleteAsync</c> needs a
/// relational provider and these tests run on EF InMemory. That is the same line
/// <c>UserOwnedDataTests</c> draws when it declines to assert cascade behaviour — the model is
/// asserted here, and the execution is left to the provider that actually implements it.
/// </para>
/// </remarks>
public class ImportRetentionTests
{
    private const string UserId = "user-1";
    private static readonly DateTimeOffset Now = new(2026, 9, 23, 12, 0, 0, TimeSpan.Zero);

    private static ApplicationDbContext NewDb()
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .Options);
        db.Database.EnsureCreated();
        return db;
    }

    /// <summary>One job, described only by the two dates the rule reads.</summary>
    private static ImportJob Job(
        string name, string state, DateTimeOffset createdAt, DateTimeOffset? completedAt) =>
        new()
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            Source = ImportSources.Grouvee,
            FileName = name,
            State = state,
            RowCount = 1,
            CreatedAt = createdAt,
            CompletedAt = completedAt
        };

    /// <summary>The names of the jobs the sweep would delete, which is what every test asserts.</summary>
    private static List<string> Expired(ApplicationDbContext db) =>
        db.ImportJobs
            .Where(ImportRetention.ExpiredAt(Now))
            .Select(job => job.FileName)
            .OrderBy(name => name)
            .ToList();

    private static ApplicationDbContext WithJobs(params ImportJob[] jobs)
    {
        var db = NewDb();
        db.ImportJobs.AddRange(jobs);
        db.SaveChanges();
        return db;
    }

    [Fact]
    public void ExpiredAt_ACompletedJobPastItsRetention_IsSelected()
    {
        using var db = WithJobs(
            Job("old.json", ImportJobStates.Done, Now.AddDays(-40), completedAt: Now.AddDays(-8)));

        Assert.Equal(["old.json"], Expired(db));
    }

    [Fact]
    public void ExpiredAt_ACompletedJobWithinItsRetention_IsLeftAlone()
    {
        using var db = WithJobs(
            Job("recent.json", ImportJobStates.Done, Now.AddDays(-40), completedAt: Now.AddDays(-6)));

        Assert.Empty(Expired(db));
    }

    [Fact]
    public void ExpiredAt_ACancelledJob_FollowsTheSameRuleAsAFinishedOne()
    {
        // Both set CompletedAt, and neither is worth keeping longer than the other: a cancelled
        // job has no result summary to come back to at all.
        using var db = WithJobs(
            Job("abandoned.json", ImportJobStates.Cancelled, Now.AddDays(-40), completedAt: Now.AddDays(-8)),
            Job("just-cancelled.json", ImportJobStates.Cancelled, Now.AddDays(-2), completedAt: Now.AddDays(-1)));

        Assert.Equal(["abandoned.json"], Expired(db));
    }

    [Fact]
    public void ExpiredAt_APendingJobOlderThanTheCompletedWindow_IsStillLeftAlone()
    {
        // The distinction the whole two-clause rule exists for. A job nobody has finished
        // reviewing is work they may still come back to, so the seven-day window — which is about
        // how long a *receipt* is useful — must not reach it.
        using var db = WithJobs(
            Job("mid-review.json", ImportJobStates.Pending, Now.AddDays(-10), completedAt: null));

        Assert.Empty(Expired(db));
    }

    [Fact]
    public void ExpiredAt_APendingJobNobodyEverCameBackTo_IsSelected()
    {
        // Without this clause it would live for ever — and hold one of the three MaxPendingJobs
        // slots with it, which eventually locks the account out of importing at all.
        using var db = WithJobs(
            Job("forgotten.json", ImportJobStates.Pending, Now.AddDays(-20), completedAt: null));

        Assert.Equal(["forgotten.json"], Expired(db));
    }

    [Fact]
    public void ExpiredAt_AJobOnTheBoundary_IsKept()
    {
        // Exactly at the cutoff is not yet past it, for both clauses. Which side the boundary
        // falls on matters less than it being stated once and tested.
        using var db = WithJobs(
            Job("exactly-seven.json", ImportJobStates.Done, Now.AddDays(-40),
                completedAt: Now - ImportRetention.KeepCompleted),
            Job("exactly-the-pending-window.json", ImportJobStates.Pending,
                Now - ImportRetention.KeepAbandoned, completedAt: null));

        Assert.Empty(Expired(db));
    }

    [Fact]
    public void ExpiredAt_AMixedTable_SelectsOnlyWhatHasExpired()
    {
        using var db = WithJobs(
            Job("a-expired-done.json", ImportJobStates.Done, Now.AddDays(-40), completedAt: Now.AddDays(-9)),
            Job("b-expired-pending.json", ImportJobStates.Pending, Now.AddDays(-60), completedAt: null),
            Job("c-fresh-done.json", ImportJobStates.Done, Now.AddDays(-3), completedAt: Now.AddDays(-2)),
            Job("d-fresh-pending.json", ImportJobStates.Pending, Now.AddDays(-1), completedAt: null));

        Assert.Equal(["a-expired-done.json", "b-expired-pending.json"], Expired(db));
    }

    [Fact]
    public void ABackgroundServiceException_StopsTheHostOnThisRuntime()
    {
        // The reason ImportRetentionService catches per tick, pinned rather than believed. Since
        // .NET 6 the default is StopHost: an exception escaping ExecuteAsync is logged and the
        // *process exits*, so one failed sweep would take the API down and have ECS replace the
        // task. Before .NET 6 it was the opposite — the service died and the host carried on —
        // and that stale description is what the first version of this change shipped in four
        // places.
        //
        // Asserted against HostOptions rather than described in a comment, so that a future
        // runtime changing the default fails here instead of quietly making the reasoning wrong
        // again.
        Assert.Equal(
            BackgroundServiceExceptionBehavior.StopHost,
            new HostOptions().BackgroundServiceExceptionBehavior);
    }

    [Fact]
    public void KeepAbandoned_IsLongerThanKeepCompleted()
    {
        // Not a tautology: swapping the two would silently delete jobs people are part way through
        // reviewing while keeping receipts nobody reads, and every other test here would pass.
        Assert.True(ImportRetention.KeepAbandoned > ImportRetention.KeepCompleted);
    }
}
