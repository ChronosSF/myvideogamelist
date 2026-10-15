using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Observability;

/// <summary>
/// <c>GET /api/version</c>: which commit this process was built from, and when.
/// </summary>
/// <remarks>
/// <para>
/// The values are configuration the image sets: the Dockerfile turns its <c>GIT_SHA</c> and
/// <c>BUILD_TIME</c> build arguments into <c>Build__Sha</c> and <c>Build__Time</c>, which the
/// deploy workflow fills from the commit it built. Nothing is computed here, and nothing is asked of
/// the database or IGDB, so it answers whenever the process does — the same promise
/// <c>/healthz</c> makes.
/// </para>
/// <para>
/// Under <c>/api/</c>, unlike the two health endpoints, because one hostname serves both processes
/// and the balancer sends every path it does not name to the SSR server. That server answers
/// <c>/version</c> for itself; at the same path the two would collide, and this one could be
/// reached through the distribution only by a listener rule that hid the other. Here it is routed
/// as every API call is. See <c>docs/decisions/0059-*</c>.
/// </para>
/// </remarks>
public static class BuildVersion
{
    public const string Path = "/api/version";

    public const string Unknown = "unknown";

    public static RouteHandlerBuilder MapBuildVersion(this IEndpointRouteBuilder endpoints) =>
        endpoints.MapGet(Path, (HttpContext context, IConfiguration configuration) =>
        {
            // A cached answer is exactly wrong for a question about what is running now.
            context.Response.Headers.CacheControl = "no-store";
            return Read(configuration);
        });

    internal static BuildVersionDto Read(IConfiguration configuration) =>
        new(ValueOf(configuration["Build:Sha"]), ValueOf(configuration["Build:Time"]));

    private static string ValueOf(string? value) => string.IsNullOrWhiteSpace(value) ? Unknown : value;
}
