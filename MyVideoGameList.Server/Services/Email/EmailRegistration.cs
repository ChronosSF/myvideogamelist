using System.Net.Mail;
using Amazon;
using Amazon.Runtime;
using Amazon.Runtime.Credentials;
using Amazon.SimpleEmailV2;

namespace MyVideoGameList.Server.Services.Email;

public static class EmailRegistration
{
    public const string SectionName = "Email";

    /// <summary>
    /// How long each HTTP request to SES may take. The default is <see cref="HttpClient"/>'s hundred
    /// seconds, which somebody waiting on a sign-up would sit out for each of the SDK's tries. The SDK
    /// tries more than once, so the whole send is bounded as well, by
    /// <see cref="SesEmailTransport.Deadline"/>.
    /// </summary>
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(10);

    /// <summary>
    /// The name the role session goes by in the production account's CloudTrail.
    /// </summary>
    private const string RoleSessionName = "mvgl-api-email";

    /// <summary>
    /// Registers the <see cref="EmailSender"/> and the <see cref="IEmailTransport"/> that delivers for
    /// it: SES where <c>Email:Ses:Region</c> is set, the outbox folder where <c>Email:OutboxPath</c> is
    /// or the environment is Development, and otherwise nothing, which stops the host here.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Refusing to start is the point. An account that cannot be sent its confirmation can never be
    /// confirmed, so a deployment missing this would accept sign-ups it can never finish, with a clean
    /// log until somebody wrote in. The key ring fails the same way, for the same kind of reason (ADR
    /// 0043). The outbox outside Development is for the integration suite, the build's migration
    /// bundle, and the production image run on a developer machine.
    /// </para>
    /// <para>
    /// <c>Email:Ses:RoleArn</c> names a role in another account to send as. The dev environment sends
    /// through the production account's SES this way, because SES's production access is per account
    /// and production's is the one granted, and because SES's own sending authorization would not
    /// help: a delegate sender's account must leave the sandbox itself. Without it the task role's own
    /// credentials send, as production's will. See <c>docs/decisions/0088-*</c>.
    /// </para>
    /// <para>
    /// Read as plain values rather than bound, as <c>EdgeInvalidationRegistration</c> reads its own: a
    /// key present with a null value would bind a null into a property declared never to hold one.
    /// </para>
    /// </remarks>
    public static IServiceCollection AddEmail(
        this IServiceCollection services, IConfiguration configuration, IHostEnvironment environment)
    {
        var section = configuration.GetSection(SectionName);
        var sender = new EmailSender(
            Address(section, "From", $"{EmailIdentity.FromName} <{EmailIdentity.FromAddress}>"),
            Address(section, "ReplyTo"));
        services.AddSingleton(sender);

        var region = Value(section, "Ses:Region");

        // Where an email's links lead. Required where mail really leaves, because a link to the wrong
        // host is a confirmation nobody can finish; on a developer machine it is the dev server.
        var site = Value(section, "SiteUrl") ?? (region is null ? DevelopmentSite : null)
            ?? throw new InvalidOperationException(
                $"{SectionName}:SiteUrl must name the site an email's links lead to wherever SES sends.");
        services.AddSingleton(new EmailLinks(Origin(site)));
        services.AddScoped<AccountEmails>();
        // Its one consumer, beside it: an account's confirmation, paced (ADR 0089).
        services.AddScoped<AccountConfirmation>();

        if (region is not null)
        {
            // The sending role, production's and the one dev assumes, allows this one address and no
            // other, so any other would start and then have every send refused (ADR 0088). The display
            // name is free.
            if (!string.Equals(sender.From.Address, EmailIdentity.FromAddress, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidOperationException(
                    $"{SectionName}:From must be {EmailIdentity.FromAddress} wherever SES sends: the sending "
                    + "role allows that address and no other. Change EmailIdentity, and the role with it.");
            }

            var roleArn = Value(section, "Ses:RoleArn");
            services.AddSingleton<IAmazonSimpleEmailServiceV2>(_ => Client(region, roleArn));
            // The client is asked for on each send rather than handed over at construction, because
            // making it resolves credentials, and a failure there has to be a send that did not go,
            // inside the transport's handling, not a request that cannot build its controller.
            services.AddSingleton<IEmailTransport>(provider => new SesEmailTransport(
                provider.GetRequiredService<IAmazonSimpleEmailServiceV2>,
                sender,
                provider.GetRequiredService<ILogger<SesEmailTransport>>()));
            return services;
        }

        var outbox = Value(section, "OutboxPath");
        if (outbox is null)
        {
            if (!environment.IsDevelopment())
            {
                throw new InvalidOperationException(
                    "No email sender is configured, so no account could be sent its confirmation. A "
                    + "deployment sets Email:Ses:Region, and Email:Ses:RoleArn to send as another "
                    + "account's role. Email:OutboxPath writes every email to a folder instead, which is "
                    + "for running the production image on a developer machine. See ADR 0088.");
            }

            outbox = Path.Combine(Path.GetTempPath(), "mvgl-outbox");
        }

        services.AddSingleton<IEmailTransport>(provider => new OutboxEmailTransport(
            outbox,
            sender,
            provider.GetRequiredService<TimeProvider>(),
            provider.GetRequiredService<ILogger<OutboxEmailTransport>>()));
        return services;
    }

    /// <summary>
    /// The SES client: in <paramref name="region"/>, where the domain is verified, with the task's own
    /// credentials, or with a session of <paramref name="roleArn"/> made from them.
    /// </summary>
    /// <remarks>
    /// The role's session is renewed by the SDK before it expires; nothing here holds a token. STS is
    /// asked in the task's own Region, which the SDK reads from <c>AWS_REGION</c>, set by Fargate.
    /// </remarks>
    private static AmazonSimpleEmailServiceV2Client Client(string region, string? roleArn)
    {
        var config = new AmazonSimpleEmailServiceV2Config
        {
            RegionEndpoint = RegionEndpoint.GetBySystemName(region),
            Timeout = RequestTimeout,
        };

        if (roleArn is null) return new AmazonSimpleEmailServiceV2Client(config);

        var credentials = new AssumeRoleAWSCredentials(
            DefaultAWSCredentialsIdentityResolver.GetCredentials(),
            roleArn,
            RoleSessionName);
        return new AmazonSimpleEmailServiceV2Client(credentials, config);
    }

    /// <summary>The dev server's origin, which <c>npm run dev</c> serves the site from.</summary>
    private const string DevelopmentSite = "https://localhost:58546";

    /// <summary>
    /// An origin and nothing else: a link is built by appending a path, so a path, a query or a
    /// fragment here would land in the middle of every link.
    /// </summary>
    private static Uri Origin(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
            && uri.Scheme is "https" or "http"
            && uri.AbsolutePath == "/" && uri.Query.Length == 0 && uri.Fragment.Length == 0
                ? uri
                : throw new InvalidOperationException(
                    $"{SectionName}:SiteUrl must be an origin, such as https://dev.myvideogamelist.net.");

    private static MailAddress Address(IConfigurationSection section, string key, string? fallback = null) =>
        MailAddress.TryCreate(Value(section, key) ?? fallback, out var address)
            ? address
            : throw new InvalidOperationException($"{SectionName}:{key} must be an email address.");

    private static string? Value(IConfigurationSection section, string key) =>
        section[key]?.Trim() is { Length: > 0 } value ? value : null;
}
