using Amazon;
using Amazon.CloudFront;

namespace MyVideoGameList.Server.Services.Edge;

/// <summary>
/// Which CDN, if any, is in front of this deployment, and how much it may be asked to forget.
/// </summary>
public sealed class EdgeInvalidationOptions
{
    public const string SectionName = "CloudFront";

    /// <summary>The ceiling when configuration names none.</summary>
    public const int DefaultDailyPathLimit = 500;

    /// <summary>
    /// The CloudFront distribution in front of the site, by id. Empty means there is none, which is
    /// true of <c>dotnet run</c>: withdrawals are then logged and nothing reaches AWS.
    /// </summary>
    /// <remarks>
    /// Configuration rather than a lookup, because a resume creates a new distribution with a new id
    /// (ADR 0046) and the application stack that creates it is the one place that knows which it
    /// is. It passes it to the API task as <c>CloudFront__DistributionId</c>.
    /// </remarks>
    public string DistributionId { get; set; } = "";

    /// <summary>
    /// The most invalidation paths one task sends in a UTC day; past it, a withdrawal keeps the TTL
    /// window. Each path past the account's free thousand a month costs half a cent, and any
    /// signed-in account can withdraw in a loop, so this is the one hard bound on the bill.
    /// </summary>
    public int DailyPathLimit { get; set; } = DefaultDailyPathLimit;
}

public static class EdgeInvalidationRegistration
{
    /// <summary>
    /// How long each HTTP request to CloudFront's API may take; the SDK makes up to three per call.
    /// The default is <see cref="HttpClient"/>'s hundred seconds, which a hung call would sit out
    /// three times over before the sender could try again.
    /// </summary>
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);

    /// <summary>
    /// Registers <see cref="ProfileWithdrawals"/> and the <see cref="IEdgeInvalidator"/> it sends
    /// through: CloudFront when a distribution is configured, a logger otherwise.
    /// </summary>
    /// <remarks>
    /// Nothing AWS is registered without a distribution id, so Development and the tests cannot
    /// reach it by accident — there is no client to reach it with. See
    /// <c>docs/decisions/0058-a-withdrawal-leaves-the-edge-when-it-is-made.md</c>.
    /// </remarks>
    public static IServiceCollection AddEdgeInvalidation(
        this IServiceCollection services, IConfiguration configuration)
    {
        services.AddScoped<ProfileWithdrawals>();

        // Read as plain values rather than bound: a key present with a null value binds a null into
        // a property declared never to hold one.
        var section = configuration.GetSection(EdgeInvalidationOptions.SectionName);
        var distributionId = section[nameof(EdgeInvalidationOptions.DistributionId)]?.Trim();

        if (string.IsNullOrEmpty(distributionId))
        {
            services.AddSingleton<IEdgeInvalidator, LoggingEdgeInvalidator>();
            return services;
        }

        var dailyPathLimit = int.TryParse(section[nameof(EdgeInvalidationOptions.DailyPathLimit)], out var limit)
            && limit >= 0
                ? limit
                : EdgeInvalidationOptions.DefaultDailyPathLimit;

        // Credentials from the task role, as the key ring's Systems Manager client takes them. The
        // Region is named rather than read from the task's own: CloudFront's API is global, and the
        // SDK sends to cloudfront.amazonaws.com whichever Region it is given, so naming one only
        // keeps this client from depending on AWS_REGION being set.
        services.AddSingleton<IAmazonCloudFront>(_ => new AmazonCloudFrontClient(new AmazonCloudFrontConfig
        {
            RegionEndpoint = RegionEndpoint.USEast1,
            Timeout = RequestTimeout,
        }));

        // One instance, registered three ways: as itself, as what the services queue on, and as the
        // hosted service that drains the queue. By factory each time rather than by type, or the
        // host would build a second instance whose queue nothing ever writes to.
        services.AddSingleton(provider => new CloudFrontEdgeInvalidator(
            provider.GetRequiredService<IAmazonCloudFront>(),
            distributionId,
            dailyPathLimit,
            provider.GetRequiredService<TimeProvider>(),
            provider.GetRequiredService<ILogger<CloudFrontEdgeInvalidator>>()));
        services.AddSingleton<IEdgeInvalidator>(provider => provider.GetRequiredService<CloudFrontEdgeInvalidator>());
        services.AddHostedService(provider => provider.GetRequiredService<CloudFrontEdgeInvalidator>());

        return services;
    }
}
