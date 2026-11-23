using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.Route53;
using Constructs;

namespace Infra;

/// <summary>
/// The certificate CloudFront presents, which has to live in us-east-1 whatever Region the rest of
/// the environment runs in. Validated by DNS in the environment's zone. For an environment whose zone
/// is its own, that zone is in the other Region, hence the cross-region reference both stacks opt
/// into. Production's is the domain's, made by hand, and is looked up here (ADR 0044, 0103).
/// </summary>
public sealed class EdgeCertStack : Stack
{
    public ICertificate Certificate { get; }

    /// <summary>
    /// The zone the environment's names live in: the one handed in, or, for production, the domain's
    /// own, looked up. The other stacks take it from here, so that the lookup is made once.
    /// </summary>
    public IHostedZone Zone { get; }

    /// <param name="zone">
    /// The environment's own zone, from its Dns stack; null for production, whose zone is the
    /// domain's and is never made by a stack.
    /// </param>
    public EdgeCertStack(Construct scope, string id, IStackProps props, Site site, IHostedZone? zone)
        : base(scope, id, props)
    {
        // Looked up, never created, and looked up here rather than in each stack that needs it: a
        // lookup is cached in cdk.context.json under the account and Region of the stack that asks,
        // and the holding page's stack asked from this Region first (ADR 0066), so this one finds the
        // answer already there. What comes back is the zone's id as a plain string, so the stacks in
        // the other Region use it with no reference between them.
        Zone = zone ?? HostedZone.FromLookup(this, "Zone", new HostedZoneProviderProps { DomainName = site.Host });

        // The host, and every name that redirects to it: CloudFront refuses an alternate name its
        // certificate does not cover.
        var redirected = site.RedirectedHosts;
        Certificate = new Certificate(this, "Certificate", new CertificateProps
        {
            DomainName = site.Host,
            SubjectAlternativeNames = redirected.Length > 0 ? redirected : null,
            Validation = CertificateValidation.FromDns(Zone),
        });

        _ = new CfnOutput(this, "CertificateArn", new CfnOutputProps { Value = Certificate.CertificateArn });
    }
}
