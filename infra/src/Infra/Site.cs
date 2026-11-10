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

    /// <summary>
    /// The production account: the domain's zone, the SES identity, and production access (ADR 0044,
    /// 0088).
    /// </summary>
    /// <remarks>
    /// Named here, with <see cref="DevAccount"/>, because a role in one account trusts a role in the
    /// other, and each side has to say which. An account id grants nothing by itself, and
    /// <c>cdk.context.json</c> has named both since the first lookups, in its keys.
    /// </remarks>
    public const string ProductionAccount = "381466680659";

    /// <summary>The dev environment's account.</summary>
    public const string DevAccount = "334393515036";

    /// <summary>The environment's account.</summary>
    public string Account => IsProduction ? ProductionAccount : Env == "dev" ? DevAccount
        : throw new InvalidOperationException($"No account is known for env={Env}.");

    /// <summary>
    /// The Region the domain is verified in with SES, where production access was granted (#418).
    /// </summary>
    /// <remarks>
    /// Named rather than taken from the deploying profile, as no other Region here is but
    /// CloudFront's: an SES identity and its production access belong to one Region, so the stack
    /// that grants sending on it, and every API that sends, have to name that one, whatever Region a
    /// profile defaults to (ADR 0088).
    /// </remarks>
    public const string EmailRegion = "eu-central-1";

    /// <summary>
    /// The address every email is from, and the only one the production account's email role lets
    /// another account send from: the API's own constant, compiled into this app, so the role and the
    /// API's default <c>Email:From</c> cannot drift (ADR 0088).
    /// </summary>
    public const string EmailFromAddress = MyVideoGameList.Server.Services.Email.EmailIdentity.FromAddress;

    /// <summary>
    /// The SES configuration set every email is sent under, made by the production account's email
    /// stack: the API's own constant, which every send names (ADR 0091).
    /// </summary>
    public const string EmailConfigurationSet = MyVideoGameList.Server.Services.Email.EmailIdentity.ConfigurationSet;

    /// <summary>
    /// What a role that sends email may send on: the domain's identity, and the configuration set every
    /// send names, which SES authorizes <c>SendEmail</c> against as well (ADR 0088, 0091). Always in the
    /// production account and <see cref="EmailRegion"/>, whoever sends.
    /// </summary>
    public static string[] EmailSendingResources(string partition) =>
    [
        $"arn:{partition}:ses:{EmailRegion}:{ProductionAccount}:identity/{Domain}",
        $"arn:{partition}:ses:{EmailRegion}:{ProductionAccount}:configuration-set/{EmailConfigurationSet}",
    ];

    /// <summary>
    /// The API task's role, by name rather than CloudFormation's generated one, because the
    /// production account's email role trusts it by its ARN, and a park and a resume make it anew.
    /// </summary>
    public string ApiTaskRoleName => $"{Prefix}-api-task";

    /// <summary>
    /// The role in the production account that this environment's API sends email as, through
    /// production's SES (ADR 0088). Production's own API will send as its task role, with no such role.
    /// </summary>
    public string EmailRoleName => $"{Prefix}-email";

    /// <summary>The ARN of <see cref="EmailRoleName"/>, which is always in the production account.</summary>
    public string EmailRoleArn => $"arn:aws:iam::{ProductionAccount}:role/{EmailRoleName}";
}
