using Microsoft.Extensions.Diagnostics.HealthChecks;
using MyVideoGameList.Server.Services;

namespace MyVideoGameList.Server.HealthChecks;

/// <summary>
/// Readiness check confirming IGDB is reachable and the configured credentials are accepted.
/// Reported as Degraded rather than Unhealthy: browsing breaks without IGDB, but the app still
/// serves auth and stored lists, so a load balancer should not pull the instance out of rotation.
/// </summary>
public class IgdbHealthCheck(IIgdbService igdbService) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        return await igdbService.IsReachableAsync(cancellationToken)
            ? HealthCheckResult.Healthy("IGDB reachable.")
            : HealthCheckResult.Degraded("IGDB unreachable or credentials rejected.");
    }
}
