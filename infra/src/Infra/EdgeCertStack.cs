using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.Route53;
using Constructs;

namespace Infra;

/// <summary>
/// The certificate CloudFront presents, which has to live in us-east-1 whatever Region the rest of
/// the environment runs in. Validated by DNS in the environment's zone, which is in that other
/// Region - hence the cross-region reference both stacks opt into.
/// </summary>
public sealed class EdgeCertStack : Stack
{
    public ICertificate Certificate { get; }

    public EdgeCertStack(Construct scope, string id, IStackProps props, Site site, IHostedZone zone)
        : base(scope, id, props)
    {
        Certificate = new Certificate(this, "Certificate", new CertificateProps
        {
            DomainName = site.Host,
            Validation = CertificateValidation.FromDns(zone),
        });

        _ = new CfnOutput(this, "CertificateArn", new CfnOutputProps { Value = Certificate.CertificateArn });
    }
}
