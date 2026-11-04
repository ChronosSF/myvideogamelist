namespace Infra;

/// <summary>
/// Every name the stacks agree on, derived from the one context value that distinguishes an
/// environment. <c>prod</c> is later a second value and a second account, not a second code base
/// (ADR 0044).
/// </summary>
public sealed record Site(string Env)
{
    /// <summary>The registered domain, whose zone lives in the production account (ADR 0044).</summary>
    public const string Domain = "myvideogamelist.net";

    /// <summary>Production's <c>env</c>: the one environment that answers at the domain itself.</summary>
    public const string Production = "prod";

    public bool IsProduction => Env == Production;

    /// <summary>The resource-name prefix: <c>mvgl-dev</c>.</summary>
    public string Prefix => $"mvgl-{Env}";

    /// <summary>The stack-name prefix: <c>Mvgl-dev-Data</c>.</summary>
    public string StackName(string part) => $"Mvgl-{Env}-{part}";

    /// <summary>
    /// The public hostname, and the name of the environment's hosted zone: <c>dev.myvideogamelist.net</c>,
    /// whose zone is delegated from the domain's, and for production the domain itself - the apex is
    /// the canonical host and <c>www</c> only redirects to it (ADR 0066).
    /// </summary>
    public string Host => IsProduction ? Domain : $"{Env}.{Domain}";

    /// <summary>The Cloud Map private namespace the SSR server finds the API through.</summary>
    public string InternalDomain => $"{Prefix}.internal";

    /// <summary>The Parameter Store path the Data Protection key ring lives under (ADR 0043).</summary>
    public string DataProtectionPath => $"/mvgl/{Env}/data-protection";

    /// <summary>The ECS cluster both services run in.</summary>
    public string ClusterName => Prefix;

    /// <summary>The database instance's identifier, which is also what its metrics are named by.</summary>
    public string DatabaseIdentifier => $"{Prefix}-db";

    public string DbSecretName => $"mvgl/{Env}/db";

    public string IgdbSecretName => $"mvgl/{Env}/igdb";

    /// <summary>
    /// The only GitHub Actions identity allowed to assume the deploy role: a job in this repository
    /// that declares this environment. Matched with StringEquals, never a wildcard (ADR 0044).
    /// </summary>
    public string GitHubSubject => $"repo:ChronosSF/myvideogamelist:environment:{Env}";

    public string LogGroup(string part) => $"/mvgl/{Env}/{part}";

    /// <summary>
    /// The header the distribution sends and the balancer's listener requires, and the secret its
    /// value lives in. The managed prefix list proves only that a request came through <em>some</em>
    /// distribution; this proves it was ours (ADR 0046).
    /// </summary>
    public string OriginVerifyHeader => "X-Origin-Verify";

    public string OriginVerifySecretName => $"mvgl/{Env}/origin-verify";

    /// <summary>
    /// The topic every alarm of the environment is sent to, which the Alerts stack keeps and the
    /// alarms name rather than reference, so that no App deploy waits on it (ADR 0080).
    /// </summary>
    public string AlertsTopicName => $"{Prefix}-alerts";

    /// <summary>
    /// The Parameter Store parameter holding the address the alarms are emailed to. Set by hand in
    /// the environment's account and read at deploy time: the repository is public (ADR 0080).
    /// </summary>
    public string AlarmEmailParameter => $"/mvgl/{Env}/alarm-email";

    /// <summary>The namespace of the metrics the API's log feeds.</summary>
    public string MetricNamespace => $"MVGL/{Env}";
}
