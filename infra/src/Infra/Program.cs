using Amazon.CDK;

namespace Infra;

/// <summary>
/// One app, parameterised by context. <c>env</c> prefixes every stack and resource name;
/// <c>imageTag</c> is the git SHA the two images were pushed under, and without it the application
/// and migration stacks carry an error the CLI refuses to deploy over, so the long-lived stacks
/// deploy without one and nothing ever falls back to <c>latest</c>. The Region comes from the
/// profile; nothing here names one except the certificate stack's <c>us-east-1</c>. See ADR 0044.
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
        var regional = new Amazon.CDK.Environment
        {
            Account = account,
            Region = System.Environment.GetEnvironmentVariable("CDK_DEFAULT_REGION"),
        };
        // CloudFront reads certificates from us-east-1 and nowhere else.
        var edge = new Amazon.CDK.Environment { Account = account, Region = "us-east-1" };

        // The three long-lived stacks refuse deletion: a mistake in one of them is a zone whose
        // name servers are delegated to, or a database. The two per-release stacks stay disposable.
        // The zone is referenced from the certificate stack in another Region, which CDK carries
        // over with a parameter rather than a CloudFormation export; both sides must opt in.
        var dns = new DnsStack(app, site.StackName("Dns"),
            new StackProps { Env = regional, CrossRegionReferences = true, TerminationProtection = true }, site);
        var edgeCert = new EdgeCertStack(app, site.StackName("EdgeCert"),
            new StackProps { Env = edge, CrossRegionReferences = true, TerminationProtection = true }, site, dns.Zone);
        var data = new DataStack(app, site.StackName("Data"),
            new StackProps { Env = regional, TerminationProtection = true }, site, dns.Zone);

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
        // The distribution presents the us-east-1 certificate, carried over the same way the zone is
        // carried into the certificate stack; the application stack opts in on its side.
        var application = new AppStack(app, site.StackName("App"),
            new StackProps { Env = regional, CrossRegionReferences = true }, site, dns.Zone, data, edgeCert.Certificate, tag);
        if (imageTag is null)
        {
            foreach (var stack in new Stack[] { migrate, application })
            {
                Annotations.Of(stack).AddError(
                    $"{stack.StackName} deploys an image, so name it: -c imageTag=<sha>. The long-lived stacks need no tag.");
            }
        }

        app.Synth();
    }
}
