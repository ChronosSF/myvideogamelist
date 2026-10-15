using MyVideoGameList.Server.DTOs;

namespace MyVideoGameList.Server.Observability;

/// <summary>
/// Which commit this process was built from, and when, as <c>GET /api/version</c> answers it.
/// </summary>
/// <remarks>
/// The values are configuration the image sets: the Dockerfile turns its <c>GIT_SHA</c> and
/// <c>BUILD_TIME</c> build arguments into <c>Build__Sha</c> and <c>Build__Time</c>, which the deploy
/// workflow fills from the commit it built. Either is <c>unknown</c> wherever the build did not say.
/// </remarks>
internal static class BuildVersion
{
    public const string Unknown = "unknown";

    public static BuildVersionDto Read(IConfiguration configuration) =>
        new(ValueOf(configuration["Build:Sha"]), ValueOf(configuration["Build:Time"]));

    private static string ValueOf(string? value) => string.IsNullOrWhiteSpace(value) ? Unknown : value;
}
