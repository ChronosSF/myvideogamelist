namespace Infra;

/// <summary>
/// Every name the stacks agree on, derived from the one context value that distinguishes an
/// environment. <c>prod</c> is later a second value and a second account, not a second code base
/// (ADR 0044).
/// </summary>
public sealed record Site(string Env)
{
    /// <summary>The resource-name prefix: <c>mvgl-dev</c>.</summary>
    public string Prefix => $"mvgl-{Env}";

    /// <summary>The stack-name prefix: <c>Mvgl-dev-Data</c>.</summary>
    public string StackName(string part) => $"Mvgl-{Env}-{part}";

    /// <summary>The public hostname, and the name of the environment's hosted zone.</summary>
    public string Host => $"{Env}.myvideogamelist.net";

    /// <summary>The Cloud Map private namespace the SSR server finds the API through.</summary>
    public string InternalDomain => $"{Prefix}.internal";

    /// <summary>The Parameter Store path the Data Protection key ring lives under (ADR 0043).</summary>
    public string DataProtectionPath => $"/mvgl/{Env}/data-protection";

    public string DbSecretName => $"mvgl/{Env}/db";

    public string IgdbSecretName => $"mvgl/{Env}/igdb";

    /// <summary>
    /// The only GitHub Actions identity allowed to assume the deploy role: a job in this repository
    /// that declares this environment. Matched with StringEquals, never a wildcard (ADR 0044).
    /// </summary>
    public string GitHubSubject => $"repo:ChronosSF/myvideogamelist:environment:{Env}";

    public string LogGroup(string part) => $"/mvgl/{Env}/{part}";
}
