using Amazon.CDK;

namespace Infra;

/// <summary>
/// One app, parameterised by context. <c>env</c> prefixes every stack and resource name;
/// <c>imageTag</c> is the git SHA the two images were pushed under, and the application and
/// migration stacks exist only when it is supplied, so the long-lived stacks deploy without one and
/// nothing ever falls back to <c>latest</c>; <c>allowedCidr</c> is the one address the balancer
/// admits before CloudFront exists. The Region comes from the profile; nothing here names one except
/// the certificate stack's <c>us-east-1</c>. See ADR 0044.
/// </summary>
internal static class Program
{
    private static void Main()
    {
        var app = new App();

        var env = app.Node.TryGetContext("env") as string
            ?? throw new InvalidOperationException("Name the environment: cdk <command> -c env=dev");
        var imageTag = app.Node.TryGetContext("imageTag") as string;
        var allowedCidr = app.Node.TryGetContext("allowedCidr") as string;

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
        _ = new EdgeCertStack(app, site.StackName("EdgeCert"),
            new StackProps { Env = edge, CrossRegionReferences = true, TerminationProtection = true }, site, dns.Zone);
        var data = new DataStack(app, site.StackName("Data"),
            new StackProps { Env = regional, TerminationProtection = true }, site, dns.Zone, allowedCidr);

        if (imageTag is not null)
        {
            _ = new MigrateStack(app, site.StackName("Migrate"),
                new StackProps { Env = regional }, site, data, imageTag);
            _ = new AppStack(app, site.StackName("App"),
                new StackProps { Env = regional }, site, dns.Zone, data, imageTag);
        }

        app.Synth();
    }
}
