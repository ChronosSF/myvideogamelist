using Amazon.CloudFront;
using Amazon.CloudFront.Model;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using MyVideoGameList.Server.Services.Edge;
using NSubstitute;

namespace MyVideoGameList.Server.Tests;

/// <summary>
/// What the CloudFront invalidator does with a withdrawal once it has one: the request it builds,
/// how it retries, when it gives up, and that nothing it meets on the way escapes.
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
/// window is the point.
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
        AttemptTimeout: TimeSpan.FromMinutes(1));

    private static readonly EdgeInvalidation Withdrawal =
        new("profile made private", ["/u/alice*", "/sitemaps/profiles-*"]);

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan by) => _now = _now.Add(by);
    }

    private static CloudFrontEdgeInvalidator Invalidator(
        IAmazonCloudFront cloudFront, TimeProvider? clock = null, int capacity = 10) =>
        new(cloudFront, DistributionId, clock ?? new ManualClock(Midday),
            NullLogger<CloudFrontEdgeInvalidator>.Instance, Immediate, capacity);

    private static CloudFrontEdgeInvalidator.Queued Queued(DateTimeOffset at) => new(Withdrawal, "reference-1", at);

    private static Task<CreateInvalidationResponse> Accepted() =>
        Task.FromResult(new CreateInvalidationResponse
        {
            Invalidation = new Invalidation { Id = "I2EXAMPLE", Status = "InProgress" },
        });

    private static Task<CreateInvalidationResponse> Refused() =>
        Task.FromException<CreateInvalidationResponse>(
            new TooManyInvalidationsInProgressException("Too many invalidations in progress."));

    private static List<CreateInvalidationRequest> Requests(IAmazonCloudFront cloudFront) =>
        cloudFront.ReceivedCalls()
            .Select(call => call.GetArguments()[0])
            .OfType<CreateInvalidationRequest>()
            .ToList();

    // ---------------------------------------------------------------------------------------
    // The request
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task SendAsync_OneWithdrawal_IsOneRequestCarryingEveryPathToTheConfiguredDistribution()
    {
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ => Accepted());

        await Invalidator(cloudFront).SendAsync(Queued(Midday), CancellationToken.None);

        var request = Assert.Single(Requests(cloudFront));
        Assert.Equal(DistributionId, request.DistributionId);
        Assert.Equal("reference-1", request.InvalidationBatch.CallerReference);
        Assert.Equal(new[] { "/u/alice*", "/sitemaps/profiles-*" }, request.InvalidationBatch.Paths.Items);
        // CloudFront refuses a batch whose count and list disagree, and the SDK derives neither.
        Assert.Equal(2, request.InvalidationBatch.Paths.Quantity);
    }

    [Fact]
    public void Invalidate_GivesEachWithdrawalItsOwnCallerReference()
    {
        // Two withdrawals with the same paths are two requests: a shared reference would make
        // CloudFront answer the second with the first.
        var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>());

        invalidator.Invalidate(Withdrawal);
        invalidator.Invalidate(Withdrawal);

        Assert.True(invalidator.TryTakeQueued(out var first));
        Assert.True(invalidator.TryTakeQueued(out var second));
        Assert.NotEqual(first!.CallerReference, second!.CallerReference);
    }

    // ---------------------------------------------------------------------------------------
    // Retrying
    // ---------------------------------------------------------------------------------------

    [Fact]
    public async Task SendAsync_AFailedAttempt_IsRetriedUnderTheSameCallerReference()
    {
        // The same reference, so a retry after a response lost on the way back returns the
        // invalidation CloudFront already made rather than making, and charging for, another.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ => Refused(), _ => Accepted());

        await Invalidator(cloudFront).SendAsync(Queued(Midday), CancellationToken.None);

        var requests = Requests(cloudFront);
        Assert.Equal(2, requests.Count);
        Assert.All(requests, request => Assert.Equal("reference-1", request.InvalidationBatch.CallerReference));
    }

    [Fact]
    public async Task SendAsync_FailingUntilTheWindowCloses_GivesUpWithoutThrowing()
    {
        // Twenty minutes pass with each failed attempt. Past sixty-five, every copy an edge held
        // has expired by itself, and another attempt could remove nothing.
        var clock = new ManualClock(Midday);
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        cloudFront.CreateInvalidationAsync(Arg.Any<CreateInvalidationRequest>(), Arg.Any<CancellationToken>())
            .Returns(_ =>
            {
                clock.Advance(TimeSpan.FromMinutes(20));
                return Refused();
            });

        await Invalidator(cloudFront, clock).SendAsync(Queued(Midday), CancellationToken.None);

        // At 0, 20, 40 and 60 minutes; the fourth failure ends at 80, past the window.
        Assert.Equal(4, Requests(cloudFront).Count);
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
    public async Task SendAsync_QueuedLongerThanTheWindow_IsDroppedUnsent()
    {
        // It waited behind another withdrawal's retries for the whole of its window.
        var cloudFront = Substitute.For<IAmazonCloudFront>();
        var queuedAt = Midday - CloudFrontEdgeInvalidator.Horizon;

        await Invalidator(cloudFront).SendAsync(Queued(queuedAt), CancellationToken.None);

        Assert.Empty(Requests(cloudFront));
    }

    [Fact]
    public void Horizon_IsTheProfilePagesWindow()
    {
        // CACHE_PROFILE in @/lib/cache: five minutes fresh, then an hour of stale-while-revalidate.
        Assert.Equal(TimeSpan.FromMinutes(65), CloudFrontEdgeInvalidator.Horizon);
    }

    // ---------------------------------------------------------------------------------------
    // The queue
    // ---------------------------------------------------------------------------------------

    [Fact]
    public void Invalidate_QueueFull_DropsTheWithdrawalWithoutThrowing()
    {
        // The write it follows has committed; a full queue costs the edge, never the request.
        var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>(), capacity: 1);

        invalidator.Invalidate(Withdrawal);
        invalidator.Invalidate(Withdrawal);

        Assert.True(invalidator.TryTakeQueued(out _));
        Assert.False(invalidator.TryTakeQueued(out _));
    }

    [Fact]
    public async Task ExecuteAsync_SendsWhatIsQueuedInOrderOneRequestEach()
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
    public async Task ExecuteAsync_AfterStopping_RefusesToQueueWithoutThrowing()
    {
        // A request that withdraws something while the task shuts down is logged, not lost silently
        // into a queue nobody will read again.
        using var invalidator = Invalidator(Substitute.For<IAmazonCloudFront>());
        await invalidator.StartAsync(CancellationToken.None);
        await invalidator.StopAsync(CancellationToken.None);

        invalidator.Invalidate(Withdrawal);

        Assert.False(invalidator.TryTakeQueued(out _));
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
