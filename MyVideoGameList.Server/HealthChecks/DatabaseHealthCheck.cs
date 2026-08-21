using Microsoft.Extensions.Diagnostics.HealthChecks;
using MyVideoGameList.Server.Data;

namespace MyVideoGameList.Server.HealthChecks;

/// <summary>
/// Readiness check confirming the application can reach its database.
/// </summary>
public class DatabaseHealthCheck(ApplicationDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(
        HealthCheckContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            return await db.Database.CanConnectAsync(cancellationToken)
                ? HealthCheckResult.Healthy("Database reachable.")
                : HealthCheckResult.Unhealthy("Database unreachable.");
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return HealthCheckResult.Unhealthy("Database check threw.", ex);
        }
    }
}
