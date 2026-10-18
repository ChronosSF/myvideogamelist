using Amazon.CloudFront;
using Amazon.CloudFront.Model;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using MyVideoGameList.Server.Services.Edge;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the CloudFront invalidator does with a withdrawal once it has one: the request it builds,
/// how it retries, when it gives up, what it refuses, and that nothing it meets on the way escapes.
/// </summary>
/// <remarks>
/// <para>
/// Against a substitute <see cref="IAmazonCloudFront"/>, so what is under test is this code's
/// handling of the client and never the client: whether CloudFront accepts the request, whether the
/// task role may make it, and what an invalidation does at the edge are not tested anywhere, and
/// only a deploy can show them.
/// </para>
/// <para>
/// The delays are made nothing, so a retry runs at once; the clock is moved by hand where the
/// window is the point, and the schedule itself is tested as the pure function it is.
/// </para>
/// </remarks>
public class CloudFrontEdgeInvalidatorTests
{
    private const string DistributionId = "E2EXAMPLE";
    private static readonly DateTimeOffset Midday = new(2026, 3, 14, 12, 0, 0, TimeSpan.Zero);

    private static readonly CloudFrontEdgeInvalidator.Pacing Immediate = new(
        FirstRetry: TimeSpan.Zero,
        LongestRetry: TimeSpan.Zero,
        Spacing: TimeSpan.Zero,
        AttemptTimeout: TimeSpan.FromMinutes(1),
        ShutdownDrain: TimeSpan.FromSeconds(5));

    private static readonly EdgeInvalidation Withdrawal =
        new("profile made private", ["/u/alice*", "/sitemaps/profiles-*"]);

    private static readonly EdgeInvalidation Another = new("review edited", ["/u/bob*"]);

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    /// <summary>
    /// A clock on which every wait passes at once: a timer moves the time on by its due time and
    /// fires, so a delay taken through it is a step of the clock rather than of the test's time.
    /// </summary>
    private sealed class FastForwardClock(DateTimeOffset now) : TimeProvider
    {
        private long ticks = now.UtcTicks;

        public override DateTimeOffset GetUtcNow() => new(Interlocked.Read(ref ticks), TimeSpan.Zero);

        public override ITimer CreateTimer(TimerCallback callback, object? state, TimeSpan dueTime, TimeSpan period)
        {
            if (dueTime != Timeout.InfiniteTimeSpan)
            {
                Interlocked.Add(ref ticks, dueTime.Ticks);
                ThreadPool.QueueUserWorkItem(_ => callback(state));
            }

            return new Fired();
        }

        private sealed class Fired : ITimer
        {
            public bool Change(TimeSpan dueTime, TimeSpan period) => false;
            public void Dispose() { }
            public ValueTask DisposeAsync() => ValueTask.CompletedTask;
        }
    }

    private static CloudFrontEdgeInvalidator Invalidator(
        IAmazonCloudFront cloudFront,
        TimeProvider? clock = null,
        int capacity = 10,
        ILogger<CloudFrontEdgeInvalidator>? logger = null,
        CloudFrontEdgeInvalidator.Pacing? pacing = null,
        int dailyPathLimit = 1_000) =>
        new(cloudFront, DistributionId, dailyPathLimit, clock ?? new ManualClock(Midday),
            logger ?? new ListLogger<CloudFrontEdgeInvalidator>(), pacing ?? Immediate, capacity);

    private static CloudFrontEdgeInvalidator.Queued Queued(DateTimeOffset at, EdgeInvalidation? invalidation = null)
    {
        var withdrawal = invalidation ?? Withdrawal;
        return new(withdrawal, "reference-1", at, string.Join('\n', withdrawal.Paths));
    }

    private static Task<CreateInvalidationResponse> Accepted() =>
        Task.FromResult(new CreateInvalidationResponse
        {
            Invalidation = new Invalidation { Id = "I2EXAMPLE", Status = "InProgress" },
        });

    private static Task<CreateInvalidationResponse> Refused() =>
        Task.FromException<CreateInvalidationResponse>(
            new TooManyInvalidationsInProgressException("Too many invalidations in progress."));

    /// <summary>A call that never answers, and ends only when its token is cancelled.</summary>
    private static async Task<CreateInvalidationResponse> Hang(CancellationToken token)
    {
        await Task.Delay(Timeout.Infinite, token);
        return new CreateInvalidationResponse();
    }

    private static IAmazonCloudFront Accepting()
    {
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ => Accepted());
        return cloudFront;
    }

    private static List<CreateInvalidationRequest> Requests(IAmazonCloudFront cloudFront) =>
        cloudFront.ReceivedCalls()
            .Where(call => call.GetMethodInfo().Name == nameof(IAmazonCloudFront.CreateInvalidationAsync))
            .Select(call => (CreateInvalidationRequest)call.GetArguments()[0]!)
            .ToList();

    // ---------------------------------------------------------------------------------------
    // The request
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task SendAsync_OneWithdrawal_IsOneRequestCarryingEveryPathToTheConfiguredDistribution()
    {
        var cloudFront = Accepting();

        await Invalidator(cloudFront).SendAsync(Queued(Midday), CancellationToken.None);

        var request = Assert.Single(Requests(cloudFront));
        Assert.Equal(DistributionId, request.DistributionId);
        Assert.Equal("reference-1", request.InvalidationBatch.CallerReference);
        Assert.Equal(new[] { "/u/alice*", "/sitemaps/profiles-*" }, request.InvalidationBatch.Paths.Items);
        // CloudFront refuses a batch whose count and list disagree, and the SDK derives neither.
        Assert.Equal(2, request.InvalidationBatch.Paths.Quantity);
    }

    [Fact]
    public void Invalidate_TwoWithdrawals_EachGetsItsOwnCallerReference()
    {
        // A shared reference would make CloudFront answer the second with the first.
        var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>());

        invalidator.Invalidate(Withdrawal);
        invalidator.Invalidate(Another);

        Assert.True(invalidator.TryTakeQueued(out var first));
        Assert.True(invalidator.TryTakeQueued(out var second));
        Assert.NotEqual(first.CallerReference, second.CallerReference);
    }

    // ---------------------------------------------------------------------------------------
    // Coalescing
    // ---------------------------------------------------------------------------------------

    [Fact]
    public void Invalidate_SamePathsAlreadyWaiting_IsNotQueuedAgain()
    {
        // The one waiting is sent after both writes, so it covers both; one account saving in a loop
        // holds one place in the queue, not all of them.
        var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>());

        invalidator.Invalidate(Withdrawal);
        invalidator.Invalidate(new EdgeInvalidation("account deleted", Withdrawal.Paths));

        Assert.True(invalidator.TryTakeQueued(out var only));
        Assert.Equal("profile made private", only.Invalidation.Reason);
        Assert.False(invalidator.TryTakeQueued(out _));
    }

    [Fact]
    public async Task Invalidate_SamePathsWhileWaiting_KeepsTheWaitingOneTryingForTheLaterWritesWindow()
    {
        // Waiting behind an hour of retries, the first write's window has closed but the second's
        // has not: dropped on the first one's clock, the second withdrawal would never be sent.
        var clock = new ManualClock(Midday);
        var cloudFront = Accepting();
        var invalidator = Invalidator(cloudFront, clock);
        invalidator.Invalidate(Withdrawal);
        clock.Advance(TimeSpan.FromMinutes(60));
        invalidator.Invalidate(Withdrawal);
        clock.Advance(TimeSpan.FromMinutes(10));

        Assert.True(invalidator.TryTakeQueued(out var waiting));
        await invalidator.SendAsync(waiting, CancellationToken.None);

        Assert.Equal(Midday + TimeSpan.FromMinutes(60), waiting.QueuedAt);
        Assert.Single(Requests(cloudFront));
    }

    [Fact]
    public void Invalidate_SamePathsOnceTheFirstIsBeingSent_IsQueuedAgain()
    {
        // Once taken off the queue the first may reach CloudFront before the second write commits,
        // so the second needs a request of its own.
        var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>());
        invalidator.Invalidate(Withdrawal);
        Assert.True(invalidator.TryTakeQueued(out _));

        invalidator.Invalidate(Withdrawal);

        Assert.True(invalidator.TryTakeQueued(out _));
    }

    // ---------------------------------------------------------------------------------------
    // Retrying
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task SendAsync_AFailedAttempt_IsRetriedUnderTheSameCallerReference()
    {
        // The same reference, so a retry after a response lost on the way back returns the
        // invalidation CloudFront already made rather than making another.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ => Refused(), _ => Accepted());

        await Invalidator(cloudFront).SendAsync(Queued(Midday), CancellationToken.None);

        var requests = Requests(cloudFront);
        Assert.Equal(2, requests.Count);
        Assert.All(requests, request => Assert.Equal("reference-1", request.InvalidationBatch.CallerReference));
    }

    [Fact]
    public async Task SendAsync_FailingUntilTheWindowCloses_GivesUpWithAnErrorRatherThanThrowing()
    {
        // Twenty minutes pass with each failed attempt. Past sixty-five, every copy an edge held
        // has expired by itself, and another attempt could remove nothing.
        var clock = new ManualClock(Midday);
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                clock.Advance(TimeSpan.FromMinutes(20));
                return Refused();
            });

        await Invalidator(cloudFront, clock, logger: logger).SendAsync(Queued(Midday), CancellationToken.None);

        // At 0, 20, 40 and 60 minutes; the fourth failure ends at 80, past the window.
        Assert.Equal(4, Requests(cloudFront).Count);
        var gaveUp = Assert.Single(logger.At(LogLevel.Error), e => e.Message.StartsWith("Gave up"));
        Assert.Contains("/u/alice*", gaveUp.Message);
    }

    [Fact]
    public async Task SendAsync_AnyException_IsRetriedRatherThanEscaping()
    {
        // Not only CloudFront's own refusals: an exception escaping the loop would stop the host.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(
                _ => Task.FromException<CreateInvalidationResponse>(new HttpRequestException("Connection reset.")),
                _ => Task.FromException<CreateInvalidationResponse>(new InvalidOperationException("A bug.")),
                _ => Accepted());

        await Invalidator(cloudFront).SendAsync(Queued(Midday), CancellationToken.None);

        Assert.Equal(3, Requests(cloudFront).Count);
    }

    [Fact]
    public async Task SendAsync_HungAttempt_IsCancelledAtTheAttemptTimeoutAndRetried()
    {
        // A cancellation that is not a shutdown is a failure like any other: rethrown, it would
        // escape the loop and stop the host; never cancelled, it would hold the queue for ever.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(call => Hang(call.Arg<CancellationToken>()), _ => Accepted());
        var pacing = Immediate with { AttemptTimeout = TimeSpan.FromMilliseconds(50) };

        await Invalidator(cloudFront, pacing: pacing)
            .SendAsync(Queued(Midday), CancellationToken.None)
            .WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Equal(2, Requests(cloudFront).Count);
    }

    [Fact]
    public async Task SendAsync_PacingWaitRunsPastTheWindow_GivesUpWithoutSending()
    {
        // A hundred milliseconds of the window left and six hundred to wait for the spacing: a
        // request sent after the wait would remove nothing and still be paid for.
        var clock = new FastForwardClock(Midday);
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        var cloudFront = Accepting();
        var invalidator = Invalidator(cloudFront, clock, logger: logger,
            pacing: Immediate with { Spacing = TimeSpan.FromMilliseconds(600) });
        await invalidator.SendAsync(Queued(Midday, Another), CancellationToken.None);
        var closing = Queued(Midday - CloudFrontEdgeInvalidator.Horizon + TimeSpan.FromMilliseconds(100));

        await invalidator.SendAsync(closing, CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        Assert.Single(Requests(cloudFront));
        Assert.Single(logger.At(LogLevel.Error), e => e.Message.StartsWith("Gave up"));
    }

    [Fact]
    public async Task SendAsync_AcceptedJustAfterMidnight_CountsAgainstTheNewDay()
    {
        // Let through before midnight, accepted on a retry after it: counted on the old day, the
        // new one would start from nothing and the ceiling would pass more than it says.
        var clock = new ManualClock(new DateTimeOffset(2026, 3, 14, 23, 59, 59, TimeSpan.Zero));
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(
                _ =>
                {
                    clock.Advance(TimeSpan.FromSeconds(2));
                    return Refused();
                },
                _ => Accepted());
        var invalidator = Invalidator(cloudFront, clock, dailyPathLimit: 3);

        await invalidator.SendAsync(Queued(clock.GetUtcNow()), CancellationToken.None); // 2 paths, accepted at 00:00:01
        await invalidator.SendAsync(Queued(clock.GetUtcNow()), CancellationToken.None); // 2 more of the new day's 3

        // The first one's two attempts, and nothing for the second.
        Assert.Equal(2, Requests(cloudFront).Count);
    }

    [Fact]
    public async Task SendAsync_QueuedLongerThanTheWindow_IsDroppedUnsent()
    {
        // It waited behind another withdrawal's retries for the whole of its window.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        var queuedAt = Midday - CloudFrontEdgeInvalidator.Horizon;

        await Invalidator(cloudFront).SendAsync(Queued(queuedAt), CancellationToken.None);

        Assert.Empty(Requests(cloudFront));
    }

    [Fact]
    public void Horizon_ForAProfile_IsFiveMinutesFreshPlusAnHourStale()
    {
        // CACHE_PROFILE in @/lib/cache: five minutes fresh, then an hour of stale-while-revalidate.
        Assert.Equal(TimeSpan.FromMinutes(65), CloudFrontEdgeInvalidator.Horizon);
    }

    [Theory]
    [InlineData(1, 2)]
    [InlineData(2, 4)]
    [InlineData(3, 8)]
    [InlineData(8, 256)]
    [InlineData(9, 300)]
    [InlineData(40, 300)]
    public void Backoff_AfterAFailedAttempt_DoublesFromTwoSecondsToAFiveMinuteCeiling(int attempt, int seconds)
    {
        Assert.Equal(TimeSpan.FromSeconds(seconds), CloudFrontEdgeInvalidator.Backoff(attempt, CloudFrontEdgeInvalidator.Pacing.Default));
    }

    [Fact]
    public void RetryDelay_BackoffLandingPastTheWindow_IsCutToOneLastAttemptInsideIt()
    {
        // Without the cut, the five-minute ceiling ends the retries up to five minutes early.
        var pacing = CloudFrontEdgeInvalidator.Pacing.Default;

        Assert.Equal(TimeSpan.FromSeconds(2), CloudFrontEdgeInvalidator.RetryDelay(1, TimeSpan.FromHours(1), pacing));
        Assert.Equal(TimeSpan.FromSeconds(199), CloudFrontEdgeInvalidator.RetryDelay(9, TimeSpan.FromSeconds(200), pacing));
        Assert.Null(CloudFrontEdgeInvalidator.RetryDelay(9, TimeSpan.FromMilliseconds(500), pacing));
    }

    // ---------------------------------------------------------------------------------------
    // What it refuses
    // ---------------------------------------------------------------------------------------

    [Fact]
    public void Invalidate_QueueFull_DropsTheWithdrawalAndLogsItsPathsAsAnError()
    {
        // The write it follows has committed; a full queue costs the edge, never the request, and
        // the paths are in the log for whoever has to send them by hand.
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>(), capacity: 1, logger: logger);

        invalidator.Invalidate(Withdrawal);
        invalidator.Invalidate(Another);

        Assert.True(invalidator.TryTakeQueued(out _));
        Assert.False(invalidator.TryTakeQueued(out _));
        var error = Assert.Single(logger.At(LogLevel.Error));
        Assert.Contains("/u/bob*", error.Message);
        Assert.Contains("is full", error.Message);
    }

    [Fact]
    public async Task SendAsync_OverTheDailyLimit_IsNotSentAndSaysSoOnceADay()
    {
        var clock = new ManualClock(Midday);
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        var cloudFront = Accepting();
        var invalidator = Invalidator(cloudFront, clock, logger: logger, dailyPathLimit: 3);
        var one = new EdgeInvalidation("review edited", ["/u/carol*"]);

        await invalidator.SendAsync(Queued(Midday), CancellationToken.None);       // 2 of 3
        await invalidator.SendAsync(Queued(Midday), CancellationToken.None);       // 4 would be over
        await invalidator.SendAsync(Queued(Midday, one), CancellationToken.None);  // 3 of 3
        await invalidator.SendAsync(Queued(Midday, one), CancellationToken.None);  // over again

        Assert.Equal(2, Requests(cloudFront).Count);
        Assert.Single(logger.At(LogLevel.Error), e => e.Message.StartsWith("Reached the ceiling"));

        // A new day, a new allowance.
        clock.Advance(TimeSpan.FromDays(1));
        await invalidator.SendAsync(Queued(clock.GetUtcNow()), CancellationToken.None);

        Assert.Equal(3, Requests(cloudFront).Count);
    }

    // ---------------------------------------------------------------------------------------
    // The hosted loop
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task ExecuteAsync_TwoWithdrawalsQueued_SendsThemInOrderOneRequestEach()
    {
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        var sent = new List<IReadOnlyList<string>>();
        var both = new TaskCompletionSource();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                lock (sent)
                {
                    sent.Add(call.Arg<CreateInvalidationRequest>().InvalidationBatch.Paths.Items);
                    if (sent.Count == 2) both.TrySetResult();
                }
                return Accepted();
            });
        using var invalidator = Invalidator(cloudFront);

        await invalidator.StartAsync(CancellationToken.None);
        invalidator.Invalidate(new EdgeInvalidation("review edited", ["/u/alice*"]));
        invalidator.Invalidate(new EdgeInvalidation("review deleted", ["/u/bob*"]));
        await both.Task.WaitAsync(TimeSpan.FromSeconds(10));
        await invalidator.StopAsync(CancellationToken.None);

        Assert.Equal(2, sent.Count);
        Assert.Equal(new[] { "/u/alice*" }, sent[0]);
        Assert.Equal(new[] { "/u/bob*" }, sent[1]);
    }

    [Fact]
    public async Task Invalidate_AfterStopping_IsRefusedAndLogged()
    {
        // Refused by StopAsync itself, so it holds however soon after the start the stop comes — on
        // .NET 10 that can be before the loop has run at all.
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        using var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>(), logger: logger);
        await invalidator.StartAsync(CancellationToken.None);
        await invalidator.StopAsync(CancellationToken.None);

        invalidator.Invalidate(Withdrawal);

        Assert.False(invalidator.TryTakeQueued(out _));
        Assert.Contains(logger.At(LogLevel.Error), e => e.Message.Contains("has stopped"));
    }

    [Fact]
    public async Task StopAsync_WithWorkQueued_SendsItBeforeStopping()
    {
        // A task stopped by anything but a deploy gets no `/*` after it, so it sends what it holds.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        var first = new TaskCompletionSource();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                first.TrySetResult();
                return Accepted();
            });
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        using var invalidator = Invalidator(cloudFront, logger: logger);
        await invalidator.StartAsync(CancellationToken.None);
        invalidator.Invalidate(Withdrawal);
        await first.Task.WaitAsync(TimeSpan.FromSeconds(10));

        invalidator.Invalidate(Another);
        await invalidator.StopAsync(CancellationToken.None);

        Assert.Equal(2, Requests(cloudFront).Count);
        Assert.Empty(logger.At(LogLevel.Error));
    }

    [Fact]
    public async Task StopAsync_WorkStillUnsentAfterTheDrain_LogsEachOnesPathsAsAnError()
    {
        // CloudFront hangs, so nothing is sent in the drain: the one in flight and the one behind it
        // are each named, so they can be sent by hand.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        var started = new TaskCompletionSource();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                started.TrySetResult();
                return Hang(call.Arg<CancellationToken>());
            });
        var logger = new ListLogger<CloudFrontEdgeInvalidator>();
        var pacing = Immediate with { ShutdownDrain = TimeSpan.FromMilliseconds(50) };
        using var invalidator = Invalidator(cloudFront, logger: logger, pacing: pacing);
        await invalidator.StartAsync(CancellationToken.None);
        invalidator.Invalidate(Withdrawal);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(10));
        invalidator.Invalidate(Another);

        await invalidator.StopAsync(CancellationToken.None).WaitAsync(TimeSpan.FromSeconds(10));

        var unsent = logger.At(LogLevel.Error).Where(e => e.Message.StartsWith("Stopping with")).ToList();
        Assert.Equal(2, unsent.Count);
        Assert.Contains(unsent, e => e.Message.Contains("/u/alice*"));
        Assert.Contains(unsent, e => e.Message.Contains("/u/bob*"));
    }

    // ---------------------------------------------------------------------------------------
    // Without a distribution
    // ---------------------------------------------------------------------------------------

    [Theory]
    [InlineData("Development", LogLevel.Debug)]
    [InlineData("Production", LogLevel.Warning)]
    public void LoggingEdgeInvalidator_NoDistribution_LogsThePathsAtTheEnvironmentsLevel(string environment, LogLevel level)
    {
        // Quiet on a developer machine; a warning in a deployment withdrawing consent in the
        // database and leaving the edge to its TTL.
        var logger = new ListLogger<LoggingEdgeInvalidator>();
        var invalidator = new LoggingEdgeInvalidator(
            new Microsoft.Extensions.Hosting.Internal.HostingEnvironment { EnvironmentName = environment }, logger);

        invalidator.Invalidate(Withdrawal);

        var entry = Assert.Single(logger.Entries);
        Assert.Equal(level, entry.Level);
        Assert.Contains("/u/alice*, /sitemaps/profiles-*", entry.Message);
    }

    // ---------------------------------------------------------------------------------------
    // Registration
    // ---------------------------------------------------------------------------------------

    private static IServiceCollection Registered(string? distributionId)
    {
        var configuration = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["CloudFront:DistributionId"] = distributionId,
            })
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IHostEnvironment>(new Microsoft.Extensions.Hosting.Internal.HostingEnvironment
        {
            EnvironmentName = Environments.Development,
        });
        services.AddSingleton<TimeProvider>(new ManualClock(Midday));
        services.AddEdgeInvalidation(configuration);
        return services;
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AddEdgeInvalidation_NoDistribution_RegistersTheLoggerAndNothingThatReachesAws(string? distributionId)
    {
        var services = Registered(distributionId);

        Assert.DoesNotContain(services, d => d.ServiceType == typeof(IAmazonCloudFront));
        Assert.DoesNotContain(services, d => d.ServiceType == typeof(IHostedService));
        using var provider = services.BuildServiceProvider();
        Assert.IsType<LoggingEdgeInvalidator>(provider.GetRequiredService<IEdgeInvalidator>());
    }

    [Fact]
    public void AddEdgeInvalidation_WithADistribution_QueuesOnTheSameInstanceTheHostRuns()
    {
        // Two instances would leave the services queuing on one that nothing ever drains.
        var services = Registered(DistributionId);
        // The client is replaced before anything resolves it, so no AWS client is ever built.
        services.AddSingleton(Substitute.For<IAmazonCloudFront>());
        using var provider = services.BuildServiceProvider();

        var invalidator = provider.GetRequiredService<IEdgeInvalidator>();
        var hosted = Assert.Single(provider.GetServices<IHostedService>());

        Assert.IsType<CloudFrontEdgeInvalidator>(invalidator);
        Assert.Same(invalidator, hosted);
    }
}
