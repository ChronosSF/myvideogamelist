namespace MyVideoGameList.Server.Services.Edge;

/// <summary>
/// The invalidator wherever no distribution is configured: Development, the tests, and the
/// production image run on a developer machine. It reaches no AWS API and says what it would have
/// sent.
/// </summary>
/// <remarks>
/// Debug in Development, where nothing is in front of <c>dotnet run</c> and there is no edge to be
/// stale. A warning anywhere else, because there it is a deployment withdrawing consent in the
/// database and leaving any cache in front of it to its TTL — which is a configuration mistake
/// worth hearing about once per withdrawal, with the paths an operator would invalidate by hand.
/// </remarks>
internal sealed class LoggingEdgeInvalidator(
    IHostEnvironment environment,
    ILogger<LoggingEdgeInvalidator> logger) : IEdgeInvalidator
{
    public void Invalidate(EdgeInvalidation invalidation) =>
        logger.Log(
            environment.IsDevelopment() ? LogLevel.Debug : LogLevel.Warning,
            "No CloudFront distribution is configured; would have invalidated {Paths} ({Reason}).",
            invalidation.Paths, invalidation.Reason);
}
