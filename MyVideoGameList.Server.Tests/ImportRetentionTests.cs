using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
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

    /// <summary>
    /// One job, described only by the dates the rule reads. <paramref name="updatedAt"/> defaults
    /// to the creation date, which is what a job nobody has touched since uploading it looks like —
    /// so a test that says nothing about it is describing exactly that.
    /// </summary>
    private static ImportJob Job(
        string name, string state, DateTimeOffset createdAt, DateTimeOffset? completedAt,
        DateTimeOffset? updatedAt = null) =>
        new()
        {
            Id = Guid.NewGuid(),
            UserId = UserId,
            Source = ImportSources.Grouvee,
            FileName = name,
            State = state,
            RowCount = 1,
            CreatedAt = createdAt,
            UpdatedAt = updatedAt ?? createdAt,
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
    public void ExpiredAt_APendingJobUploadedLongAgoButWorkedOnRecently_IsKept()
    {
        // KeepAbandoned is a window of silence, not a deadline to finish by. Somebody resolving
        // five thousand unmatched titles over a month of weekends has had the job open far longer
        // than the window, and deleting it would cost them every decision they had made — which is
        // the reason the window is the longer of the two in the first place. Measuring it from
        // CreatedAt, as the first version of this did, would select this row.
        using var db = WithJobs(
            Job("long-review.json", ImportJobStates.Pending, Now.AddDays(-40), completedAt: null,
                updatedAt: Now.AddDays(-2)));

        Assert.Empty(Expired(db));
    }

    [Fact]
    public void ExpiredAt_APendingJobWhoseLastDecisionIsPastTheWindow_IsSelected()
    {
        // The other direction, so the pair pins the clock rather than just the happy case: coming
        // back once on day three does not buy the job immortality.
        using var db = WithJobs(
            Job("given-up-on.json", ImportJobStates.Pending, Now.AddDays(-40), completedAt: null,
                updatedAt: Now.AddDays(-37)));

        Assert.Equal(["given-up-on.json"], Expired(db));
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
                Now.AddDays(-40), completedAt: null,
                updatedAt: Now - ImportRetention.KeepAbandoned));

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
    public void AddScheduledWork_LeavesAnEscapingExceptionStoppingTheHost()
    {
        // The reason ImportRetentionService catches per tick, pinned rather than believed. Under
        // StopHost an exception escaping ExecuteAsync is logged and the *process exits*, so one
        // failed sweep would take the API down and have ECS replace the task.
        //
        // Resolved out of the application's own registration, not out of `new HostOptions()`. The
        // first version of this test did the latter, which pins the framework's default and
        // nothing else: a single Configure<HostOptions> in Program.cs would flip what the
        // application really does and leave this green, while the class remarks and ADR 0038 went
        // on claiming the behaviour was pinned. Setting the option in AddScheduledWork and
        // reading it back through DI is what makes the claim true — see ScheduledWork for why it
        // is stated there rather than inherited.
        using var services = new ServiceCollection().AddScheduledWork().BuildServiceProvider();

        Assert.Equal(
            BackgroundServiceExceptionBehavior.StopHost,
            services.GetRequiredService<IOptions<HostOptions>>().Value.BackgroundServiceExceptionBehavior);
    }

    [Fact]
    public void AddScheduledWork_RegistersTheRetentionSweep()
    {
        // The other half of what that call site promises. An option configured beside a hosted
        // service that is no longer registered would be a contract about nothing.
        Assert.Contains(
            new ServiceCollection().AddScheduledWork(),
            service => service.ServiceType == typeof(IHostedService)
                && service.ImplementationType == typeof(ImportRetentionService));
    }

    [Fact]
    public void KeepAbandoned_IsLongerThanKeepCompleted()
    {
        // Neither a tautology nor redundant — though for a subtler reason than this comment first
        // gave. It claimed the tests above would all pass with the two constants swapped, and that
        // is simply false: swapping them fails four of them, because each names a concrete age and
        // a concrete expectation.
        //
        // What none of those four states is *why* the ages are what they are. Read their failures
        // alone and the obvious repair is to edit the dates until they pass again, which would
        // leave a sweep that deletes reviews people are part way through and keeps receipts nobody
        // reads. This is the one assertion that says the ordering is the point.
        Assert.True(ImportRetention.KeepAbandoned > ImportRetention.KeepCompleted);
    }
}
