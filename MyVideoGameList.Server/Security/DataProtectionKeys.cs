using Microsoft.AspNetCore.DataProtection;

namespace MyVideoGameList.Server.Security;

/// <summary>
/// Where the Data Protection key ring lives: the keys that sign the Identity cookie and seal the
/// review cursor (ADR 0028).
/// </summary>
/// <remarks>
/// A ring nobody persists is made afresh by every process, so two tasks cannot read each other's
/// cookies and a deploy signs everyone out. That failure is silent — the log is clean and every
/// user sees "please sign in again" — which is why, outside Development, a ring that is persisted
/// nowhere is a startup failure unless the configuration says in so many words that it is meant.
/// See <c>docs/decisions/0042-*</c>.
/// </remarks>
public sealed class DataProtectionKeysOptions
{
    public const string SectionName = "DataProtection";

    /// <summary>
    /// The Systems Manager Parameter Store path the keys are kept under, one per environment:
    /// <c>/mvgl/dev/data-protection</c>, <c>/mvgl/prod/data-protection</c>. Each key becomes one
    /// <c>SecureString</c> parameter beneath it. Empty means the ring is not shared with anything.
    /// </summary>
    public string ParameterPath { get; set; } = "";

    /// <summary>
    /// Outside Development, the acknowledgement that the ring is not shared and will not survive
    /// the process. For running the production image on a developer machine, and nothing else: a
    /// deployment that sets this signs everyone out on every deploy, by its own decision.
    /// </summary>
    public bool AllowEphemeralKeys { get; set; }
}

public static class DataProtectionKeys
{
    /// <summary>
    /// The discriminator every protected payload is bound to. Without one, Data Protection derives
    /// it from the content root path, so moving the application inside its image would orphan
    /// every cookie and cursor ever issued while the keys themselves stayed readable.
    /// </summary>
    public const string ApplicationName = "MyVideoGameList";

    public static IServiceCollection AddDataProtectionKeys(
        this IServiceCollection services,
        IConfiguration configuration,
        IHostEnvironment environment)
    {
        var settings = configuration.GetSection(DataProtectionKeysOptions.SectionName)
            .Get<DataProtectionKeysOptions>() ?? new DataProtectionKeysOptions();

        var dataProtection = services.AddDataProtection().SetApplicationName(ApplicationName);

        if (!string.IsNullOrWhiteSpace(settings.ParameterPath))
        {
            // The Systems Manager client comes from the task's own environment: the region from
            // AWS_REGION, which the ECS agent sets, and credentials from the task role. Nothing is
            // configured here, and nothing is read until the first protect or unprotect — the
            // repository is built when KeyManagementOptions is first resolved, not at startup — so
            // a task role missing ssm:GetParametersByPath fails the first sign-in rather than the
            // boot. The proof that this works is a session surviving a redeploy, and only a deploy
            // can give it.
            dataProtection.PersistKeysToAWSSystemsManager(settings.ParameterPath);
            return services;
        }

        // On a developer machine the default ring persists in the user profile, which is exactly
        // right: one process, one machine, keys that outlive a restart.
        if (environment.IsDevelopment() || settings.AllowEphemeralKeys)
        {
            return services;
        }

        throw new InvalidOperationException(
            $"{DataProtectionKeysOptions.SectionName}:ParameterPath is empty and this is not the "
            + "Development environment, so the Data Protection key ring would live and die with "
            + "this process: every deploy and every second task would sign everyone out. Set the "
            + "Parameter Store path the keys are kept under, or - for running the production image "
            + $"on a developer machine only - set {DataProtectionKeysOptions.SectionName}:"
            + "AllowEphemeralKeys to true to say that this is meant.");
    }
}
