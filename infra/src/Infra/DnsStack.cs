using Amazon.CDK;
using Amazon.CDK.AWS.Route53;
using Constructs;

namespace Infra;

/// <summary>
/// The environment's public hosted zone, alone in a permanent stack: recreating a zone changes its
/// name servers and breaks the delegation from the apex zone in the production account (ADR 0044).
/// </summary>
public sealed class DnsStack : Stack
{
    public IPublicHostedZone Zone { get; }

    public DnsStack(Construct scope, string id, IStackProps props, Site site) : base(scope, id, props)
    {
        Zone = new PublicHostedZone(this, "Zone", new PublicHostedZoneProps
        {
            ZoneName = site.Host,
            Comment = $"{site.Host}: delegated from the apex zone by NS records",
        });

        // What the apex zone's NS record for this name has to say.
        _ = new CfnOutput(this, "NameServers", new CfnOutputProps
        {
            Value = Fn.Join(" ", Zone.HostedZoneNameServers!),
            Description = "The four name servers to delegate to from the apex zone",
        });
        _ = new CfnOutput(this, "ZoneId", new CfnOutputProps { Value = Zone.HostedZoneId });
    }
}
