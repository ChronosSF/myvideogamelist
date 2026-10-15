using System.Collections;
using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using MyVideoGameList.Server.Data;
using MyVideoGameList.Server.Models;
using MyVideoGameList.Server.Services;
using MyVideoGameList.Server.Services.Import;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// Which jobs the retention sweep selects, and which token a batch gives its commit.
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
/// <para>
/// The batch around the deletion is covered only as far as doubles reach. <c>DeleteBatchAsync</c>
/// runs here with its advisory lock and its <c>ExecuteDelete</c> answered by a scripted query
/// provider and its transaction substituted, which is enough to hold its two tokens to ADR 0038 §4
/// — the stopping token bounds the work and never the commit — and nothing more. Whether the lock
/// excludes another task and what the <c>DELETE</c> removes were verified against a real PostgreSQL
/// (§3 and §4).
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
    private static List<string> Expired(ApplicationDbContext db, DateTimeOffset? at = null) =>
        db.ImportJobs
            .Where(ImportRetention.ExpiredAt(at ?? Now))
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

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void ExpiresAt_IsTheInstantTheSweepStartsSelectingThatJob(bool completed)
    {
        // Two expressions of one rule: the sweep deletes by the predicate, and the client is told
        // the date so it can say how long a review has left. They have to agree on the boundary
        // and not approximately — a window changed in one and not the other would put a date on a
        // screen promising somebody their part-finished work is safe for longer than it is.
        var updatedAt = Now.AddDays(-30);
        var completedAt = completed ? Now.AddDays(-20) : (DateTimeOffset?)null;
        var expiresAt = ImportRetention.ExpiresAt(completedAt, updatedAt);

        using var db = WithJobs(
            Job("job.json", completed ? ImportJobStates.Done : ImportJobStates.Pending,
                createdAt: Now.AddDays(-40), completedAt: completedAt, updatedAt: updatedAt));

        Assert.Empty(Expired(db, expiresAt));
        Assert.Equal(["job.json"], Expired(db, expiresAt.AddTicks(1)));
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

    [Fact]
    public async Task DeleteBatchAsync_WhenShutdownArrivesOnceTheDeleteHasReturned_StillCommits()
    {
        // Issue #96, and the change that would undo it while looking like tidying: handing the
        // commit the stopping token like every other call. The shutdown lands the moment the
        // DELETE returns. On that token the commit used to be refused before COMMIT was sent, so a
        // batch that had finished rolled back for the next sweep to delete again.
        using var stopping = new CancellationTokenSource();
        using var db = BatchDb(out var transaction, out var queries);
        queries.OnDelete = stopping.Cancel;

        var deleted = await ImportRetentionService.DeleteBatchAsync(db, Now, stopping.Token);

        Assert.Equal(ScriptedQueries.Deleted, deleted);
        await transaction.Received(1).CommitAsync(
            Arg.Is<CancellationToken>(token => !token.IsCancellationRequested));
    }

    [Fact]
    public async Task DeleteBatchAsync_WhenShutdownArrivesBeforeTheDelete_AbandonsTheBatch()
    {
        // The other half of the rule, so that the test above cannot be satisfied by taking the
        // token off everything: the stopping token still bounds the work, and a shutdown that
        // lands before the DELETE is sent stops the batch there, with nothing committed.
        using var stopping = new CancellationTokenSource();
        using var db = BatchDb(out var transaction, out var queries);
        queries.OnLock = stopping.Cancel;

        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => ImportRetentionService.DeleteBatchAsync(db, Now, stopping.Token));

        await transaction.DidNotReceive().CommitAsync(Arg.Any<CancellationToken>());
    }

    /// <summary>
    /// A context in which <see cref="ImportRetentionService.DeleteBatchAsync"/> runs to its commit
    /// on InMemory, which by itself it cannot: <c>SqlQuery</c> refuses a provider that is not
    /// relational, and InMemory cannot translate <c>ExecuteDelete</c>. Both are answered by
    /// <see cref="ScriptedQueries"/>, and the transaction is a substitute that records the token
    /// its commit is given.
    /// </summary>
    /// <remarks>
    /// Everything replaced is public EF API, though the provider-facing kind. A release that adds a
    /// member to <see cref="IDatabaseFacadeDependencies"/> fails to compile here rather than to
    /// pass; the new member can throw like the others a batch never reaches.
    /// </remarks>
    private static ApplicationDbContext BatchDb(
        out IDbContextTransaction transaction, out ScriptedQueries queries)
    {
        var db = new ApplicationDbContext(
            new DbContextOptionsBuilder<ApplicationDbContext>()
                .UseInMemoryDatabase(Guid.NewGuid().ToString())
                .ReplaceService<IDatabaseFacadeDependencies, RelationalFacade>()
                .ReplaceService<IAsyncQueryProvider, ScriptedQueries>()
                .Options);

        // Both are scoped, so these are the very instances db.Database and db.ImportJobs use.
        transaction = ((RelationalFacade)db.GetService<IDatabaseFacadeDependencies>()).Transaction;
        queries = (ScriptedQueries)db.GetService<IAsyncQueryProvider>();
        return db;
    }

    /// <summary>
    /// The two queries a batch runs, answered without a database: the advisory lock — the only
    /// <c>Single</c> in a batch — as taken, and the <c>ExecuteDelete</c> as having removed
    /// <see cref="Deleted"/> jobs. Like a real provider, each refuses a token already cancelled
    /// before it does anything; then it runs its hook, which is where a test lands its shutdown.
    /// </summary>
    private sealed class ScriptedQueries : IAsyncQueryProvider
    {
        public const int Deleted = 3;

        public Action? OnLock { get; set; }

        public Action? OnDelete { get; set; }

        public IQueryable<TElement> CreateQuery<TElement>(Expression expression) =>
            new Scripted<TElement>(this, expression);

        public TResult ExecuteAsync<TResult>(
            Expression expression, CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var method = ((MethodCallExpression)expression).Method;

            if (method.DeclaringType == typeof(Queryable) && method.Name == nameof(Queryable.Single))
            {
                OnLock?.Invoke();
                return (TResult)(object)Task.FromResult(true);
            }

            if (method.Name == nameof(EntityFrameworkQueryableExtensions.ExecuteDelete))
            {
                OnDelete?.Invoke();
                return (TResult)(object)Task.FromResult(Deleted);
            }

            throw new NotSupportedException($"A batch runs no {method.Name}.");
        }

        public IQueryable CreateQuery(Expression expression) => throw new NotSupportedException();

        public object Execute(Expression expression) => throw new NotSupportedException();

        public TResult Execute<TResult>(Expression expression) => throw new NotSupportedException();
    }

    private sealed class Scripted<T>(IQueryProvider provider, Expression expression)
        : IOrderedQueryable<T>
    {
        public Type ElementType => typeof(T);

        public Expression Expression => expression;

        public IQueryProvider Provider => provider;

        public IEnumerator<T> GetEnumerator() => throw new NotSupportedException();

        IEnumerator IEnumerable.GetEnumerator() => GetEnumerator();
    }

    /// <summary>
    /// What <c>db.Database</c> takes its services from, made relational so that <c>SqlQuery</c>
    /// accepts it. A batch reaches four members — the transaction manager, the execution strategy
    /// factory, the query provider and the type mappings — and the rest throw, so a batch that
    /// started to need one would say so rather than run against a default.
    /// </summary>
    private sealed class RelationalFacade : IRelationalDatabaseFacadeDependencies
    {
        public RelationalFacade(
            IExecutionStrategyFactory executionStrategyFactory,
            IAsyncQueryProvider queryProvider,
            ITypeMappingSource typeMappingSource)
        {
            ExecutionStrategyFactory = executionStrategyFactory;
            QueryProvider = queryProvider;
            TypeMappingSource = typeMappingSource;
            TransactionManager.BeginTransactionAsync(Arg.Any<CancellationToken>())
                .Returns(Task.FromResult(Transaction));
        }

        public IDbContextTransaction Transaction { get; } = Substitute.For<IDbContextTransaction>();

        public IDbContextTransactionManager TransactionManager { get; } =
            Substitute.For<IDbContextTransactionManager>();

        public IExecutionStrategyFactory ExecutionStrategyFactory { get; }

        public IAsyncQueryProvider QueryProvider { get; }

        public ITypeMappingSource TypeMappingSource { get; }

        public IDatabaseCreator DatabaseCreator => throw new NotSupportedException();

        public IExecutionStrategy ExecutionStrategy => throw new NotSupportedException();

        public IEnumerable<IDatabaseProvider> DatabaseProviders => throw new NotSupportedException();

        public IConcurrencyDetector ConcurrencyDetector => throw new NotSupportedException();

        public ICoreSingletonOptions CoreOptions => throw new NotSupportedException();

        public IAdHocMapper AdHocMapper => throw new NotSupportedException();

        public IRelationalConnection RelationalConnection => throw new NotSupportedException();

        public IRawSqlCommandBuilder RawSqlCommandBuilder => throw new NotSupportedException();

        public IRelationalCommandDiagnosticsLogger CommandLogger => throw new NotSupportedException();

        IDiagnosticsLogger<DbLoggerCategory.Database.Command> IDatabaseFacadeDependencies.CommandLogger =>
            CommandLogger;
    }
}
