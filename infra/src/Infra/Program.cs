using Amazon.CDK;
using Amazon.CDK.AWS.Route53;

namespace Infra;

/// <summary>
/// One app, parameterised by context. <c>env</c> prefixes every stack and resource name;
/// <c>imageTag</c> is the git SHA the two images were pushed under, and without it the application
/// and migration stacks carry an error the CLI refuses to deploy over, so the long-lived stacks
/// deploy without one and nothing ever falls back to <c>latest</c>. The Region comes from the
/// profile; nothing here names one except <c>us-east-1</c>, for CloudFront's certificates, and
/// <see cref="Site.EmailRegion"/>, where the domain is verified with SES (ADR 0088). See ADR
/// 0044. <c>env=prod</c> is the same stacks in the production account, less the zone, which it looks
/// up, and beside them the holding page, until production takes the domain from it, and the email
/// stack (ADR 0066, 0088, 0103).
/// </summary>
internal static class Program
{
    /// <summary>
    /// What the two per-release stacks are synthesised with when no <c>imageTag</c> is given. It is
    /// never deployed: the stacks carrying it carry an error too.
    /// </summary>
    private const string NoImageTag = "unset";

    private static void Main()
    {
        var app = new App();

        var env = app.Node.TryGetContext("env") as string
            ?? throw new InvalidOperationException("Name the environment: cdk <command> -c env=dev");
        var imageTag = app.Node.TryGetContext("imageTag") as string;

        var site = new Site(env);
        var account = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_ACCOUNT");
        // An environment has one account, and the stacks go wherever the credentials point. Dev's
        // synthesise for production's account as readily as for their own, so a deploy with the other
        // environment's profile would make them there, three of them protected from deletion.
        // Production's fail in dev's account only by accident, at the zone they look up. So the account
        // is checked here, before any stack is made. A synthesis with no credentials names the account
        // itself, as CI's does.
        if (account != site.Account)
        {
            throw new InvalidOperationException(
                $"env={env} is account {site.Account}, and these credentials are for {account ?? "no account"}. "
                + "Use the environment's own profile, or set CDK_DEFAULT_ACCOUNT for a synthesis with no credentials.");
        }

        var regional = new Amazon.CDK.Environment
        {
            Account = account,
            Region = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_REGION"),
        };
        // CloudFront reads certificates from us-east-1 and nowhere else.
        var edge = new Amazon.CDK.Environment { Account = account, Region = "us-east-1" };
        // Where the alarms send. Production's is pinned to the Region the domain is verified with SES
        // in, because SES sends each bounce and complaint to the same topic (ADR 0091).
        var alerts = site.IsProduction
            ? new Amazon.CDK.Environment { Account = account, Region = Site.EmailRegion }
            : regional;

        // The zone the environment's names live in. Every environment but production has its own,
        // delegated from the domain's, alone in a permanent stack. Production's is the domain's, made
        // by hand in its account: a Dns stack must never be synthesised for it, since it would create
        // a second zone named for the domain beside the real one. The certificate stack looks that one
        // up instead (ADR 0044).
        IHostedZone? ownZone = null;
        if (site.IsProduction)
        {
            // The holding page, until production takes the domain from it (ADR 0066): one stack, whole
            // in us-east-1. Not termination-protected: it is destroyed just before the application
            // stack is first deployed, since the two answer by the same names, and holds nothing a
            // deploy would not put back (ADR 0103).
            _ = new HoldingStack(app, site.StackName("Holding"), new StackProps { Env = edge }, site);
            // The configuration set every email is sent under and the role the dev environment's API
            // sends email as, through this account's production access (ADR 0088, 0091). Pinned to the
            // Region the domain is verified in, never the profile's: a role granting the identity in
            // another Region would refuse every send. Deployed by hand, by name, after Alerts, whose
            // topic its events need.
            _ = new EmailStack(app, site.StackName("Email"), new StackProps { Env = alerts }, new Site("dev"));
        }
        else
        {
            ownZone = new DnsStack(app, site.StackName("Dns"),
                new StackProps { Env = regional, CrossRegionReferences = true, TerminationProtection = true }, site).Zone;
        }

        // Three of the long-lived stacks refuse deletion: a mistake in one of them is a zone whose
        // name servers are delegated to, or a database. The two per-release stacks stay disposable.
        // A zone of the environment's own is referenced from the certificate stack in another Region,
        // which CDK carries over with a parameter rather than a CloudFormation export; both sides must
        // opt in.
        var edgeCert = new EdgeCertStack(app, site.StackName("EdgeCert"),
            new StackProps { Env = edge, CrossRegionReferences = true, TerminationProtection = true }, site, ownZone);
        var zone = edgeCert.Zone;
        var data = new DataStack(app, site.StackName("Data"),
            new StackProps { Env = regional, TerminationProtection = true }, site, zone);
        // Where the alarms send, long-lived because an email subscription is confirmed by a person.
        // The fourth long-lived stack, and not protected: destroying it loses that confirmation and
        // nothing else, and destroying and redeploying it is how a lost subscription is made again.
        // Nothing refers to it; the alarms in App name its topic (ADR 0080).
        _ = new AlertsStack(app, site.StackName("Alerts"), new StackProps { Env = alerts }, site);

        // The two per-release stacks exist in every synthesis, tag or no tag, because the Data
        // stack's cross-stack outputs are derived from what consumes them. Cross-stack references
        // are "weak" here (cdk.json): the consumer reads the producer's output at deployment time
        // with Fn::GetStackOutput, and CloudFormation lets the producer drop that output at any
        // time - unlike an export, which it refuses to remove while something imports it. So a
        // Data deploy synthesised without these two stacks stripped every output they read, with a
        // clean log, and the next release failed with "output was not found". Without a tag the two
        // carry an error instead, which the CLI refuses to deploy over - and which a Data deploy,
        // not selecting them, never meets.
        var tag = imageTag ?? NoImageTag;
        var migrate = new MigrateStack(app, site.StackName("Migrate"),
            new StackProps { Env = regional }, site, data, tag);
        // The web ACL on the distribution, in us-east-1 as CloudFront's certificate is, but disposable:
        // it bills by the hour, so dev-env.mjs deploys it before App on a resume and destroys it after App
        // on a park (ADR 0098). Not protected, for the same reason. The pipeline never deploys it.
        var waf = new WafStack(app, site.StackName("Waf"),
            new StackProps { Env = edge, CrossRegionReferences = true }, site);
        // The distribution presents the us-east-1 certificate and names the us-east-1 web ACL, both
        // carried over the same way the zone is carried into the certificate stack: a weak reference,
        // read when App deploys, so the web ACL's stack has to be there by then. The application stack
        // opts in on its side.
        var application = new AppStack(app, site.StackName("App"),
            new StackProps { Env = regional, CrossRegionReferences = true }, site, zone, data, edgeCert.Certificate,
            waf.WebAclArn, tag);
        if (imageTag is null)
        {
            foreach (var stack in new Stack[] { migrate, application })
            {
                Annotations.Of(stack).AddError(
                    $"{stack.StackName} deploys an image, so name it: -c imageTag=<sha>. The long-lived stacks need no tag.");
            }
        }
        // An alarm can only tell a topic in its own Region, and production's topic is where SES is.
        // Dev's Alerts stack is wherever the rest of dev is, so only production can get this wrong.
        if (alerts.Region != regional.Region)
        {
            Annotations.Of(application).AddError(
                $"{application.StackName} is being synthesised for {regional.Region ?? "no Region"}, and its alarms send to the "
                + $"topic {site.StackName("Alerts")} makes in {alerts.Region}. Deploy production with a profile whose Region is that one.");
        }

        app.Synth();
    }
}
