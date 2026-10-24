using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.Route53.Targets;
using Amazon.CDK.AWS.S3;
using Amazon.CDK.AWS.S3.Deployment;
using Constructs;
using Distribution = Amazon.CDK.AWS.CloudFront.Distribution;

namespace Infra;

/// <summary>
/// The holding page at the domain until production takes it (ADR 0066): a private bucket of static
/// files, read through origin access control by one distribution that answers at the apex and at
/// <c>www</c>, and sends the second to the first. It is production's only stack until #98 builds the
/// rest, and is destroyed then, before the application stack claims the two names.
///
/// All of it lives in us-east-1, where CloudFront requires its certificate to be, so the certificate
/// is in the same stack as the distribution that presents it: no cross-region reference, no order
/// to deploy in, and one bootstrap, in the Region production's own certificate stack will need
/// anyway. The bucket holds a public page and nothing about anybody, so the reasons 0044 gives for
/// Frankfurt do not reach it.
/// </summary>
public sealed class HoldingStack : Stack
{
    /// <summary>
    /// For every file. The edge is invalidated on every deploy, so it may keep a file for a day; a
    /// browser asks again after five minutes, so a change is seen soon after it lands.
    /// </summary>
    private const string FileCacheControl = "public, max-age=300, s-maxage=86400";

    /// <summary>
    /// Stricter than any of the app's documents can be, since they run React Router's scripts and
    /// this page runs none: nothing loads but its own stylesheet and favicon, and no form goes
    /// anywhere.
    /// </summary>
    private const string ContentSecurityPolicy =
        "default-src 'none'; img-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

    public HoldingStack(Construct scope, string id, IStackProps props, Site site) : base(scope, id, props)
    {
        var www = $"www.{site.Host}";

        // Looked up, never created: the zone was made by hand in this account, the registrar names
        // its servers, and it holds the mail records and dev's delegation (ADR 0044). The first
        // synthesis with the account's credentials caches the answer in cdk.context.json.
        var zone = HostedZone.FromLookup(this, "Zone", new HostedZoneProviderProps { DomainName = site.Host });

        var certificate = new Certificate(this, "Certificate", new CertificateProps
        {
            DomainName = site.Host,
            SubjectAlternativeNames = [www],
            Validation = CertificateValidation.FromDns(zone),
        });

        // Private, and readable by this distribution alone: origin access control signs CloudFront's
        // requests, and the bucket policy CDK writes admits the CloudFront service only for this
        // distribution's ARN. Read, not list - see the error responses below.
        //
        // Destroyed with the stack, since everything in it is in holding/site in the repository,
        // and emptied first by CDK's own hook, because CloudFormation will not delete a bucket with
        // files in it. The deployment's RetainOnDelete cannot do that job: the deployment tags the
        // bucket as its own, and its delete handler leaves a bucket so tagged as it is - so a destroy
        // stopped at the bucket. CDK's README says the same for a bucket nothing else writes to.
        var bucket = new Bucket(this, "Bucket", new BucketProps
        {
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            Encryption = BucketEncryption.S3_MANAGED,
            EnforceSSL = true,
            RemovalPolicy = RemovalPolicy.DESTROY,
            AutoDeleteObjects = true,
        });

        var request = new Function(this, "Request", new FunctionProps
        {
            FunctionName = $"{site.Prefix}-holding-request",
            Runtime = FunctionRuntime.JS_2_0,
            Code = FunctionCode.FromInline(RequestFunction(site)),
            Comment = $"Sends every other host to {site.Host}, and a directory to its index.html",
        });

        // The headers the app's documents carry (entry.server.tsx, ADR 0033 §5), with the content
        // policy this page can afford, and HSTS as 0033 states it: a year, subdomains included,
        // preload off - that list is slow to leave, and is the domain owner's call, not a default's.
        // The app's documents do not send HSTS yet (#109), so this is the first response at the
        // apex that does. From a browser's first visit, every name under the domain, at any depth,
        // has to answer over HTTPS with a valid certificate, or not at all; each response restarts
        // the year, so destroying this stack does not withdraw it (ADR 0066 §6).
        var headers = new ResponseHeadersPolicy(this, "Headers", new ResponseHeadersPolicyProps
        {
            ResponseHeadersPolicyName = $"{site.Prefix}-holding-headers",
            Comment = "The holding page: the app's document headers, a content policy for a page with no script, and HSTS",
            SecurityHeadersBehavior = new ResponseSecurityHeadersBehavior
            {
                ContentTypeOptions = new ResponseHeadersContentTypeOptions { Override = true },
                ReferrerPolicy = new ResponseHeadersReferrerPolicy
                {
                    ReferrerPolicy = HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
                    Override = true,
                },
                FrameOptions = new ResponseHeadersFrameOptions { FrameOption = HeadersFrameOption.DENY, Override = true },
                ContentSecurityPolicy = new ResponseHeadersContentSecurityPolicy
                {
                    ContentSecurityPolicy = ContentSecurityPolicy,
                    Override = true,
                },
                StrictTransportSecurity = new ResponseHeadersStrictTransportSecurity
                {
                    AccessControlMaxAge = Duration.Days(365),
                    IncludeSubdomains = true,
                    Preload = false,
                    Override = true,
                },
            },
        });

        var distribution = new Distribution(this, "Distribution", new DistributionProps
        {
            Comment = $"{site.Host}: the holding page",
            DomainNames = [site.Host, www],
            Certificate = certificate,
            MinimumProtocolVersion = SecurityPolicyProtocol.TLS_V1_2_2021,
            HttpVersion = HttpVersion.HTTP2_AND_3,
            PriceClass = PriceClass.PRICE_CLASS_100,
            DefaultBehavior = new BehaviorOptions
            {
                Origin = S3BucketOrigin.WithOriginAccessControl(bucket),
                ViewerProtocolPolicy = ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                AllowedMethods = AllowedMethods.ALLOW_GET_HEAD,
                // The files say how long they keep; this policy honours that, keeps no header or
                // cookie in the key, and forwards no query string - which matters more than it looks.
                // Origin access control signs every request to the bucket, and on a signed request
                // S3 obeys response-content-type and its kin, so a forwarded query string would let
                // anybody have share.png served as HTML. No origin request policy, for that reason.
                CachePolicy = CachePolicy.CACHING_OPTIMIZED,
                ResponseHeadersPolicy = headers,
                FunctionAssociations =
                [
                    new FunctionAssociation { EventType = FunctionEventType.VIEWER_REQUEST, Function = request },
                ],
            },
            // A key the bucket does not have is a 403 from S3 rather than a 404, because the
            // distribution may read objects but not list them, and only listing tells a missing key
            // from a forbidden one. Not granting it is deliberate: a distribution that can list the
            // bucket serves the listing to anybody who asks for its root. So both become the 404 page,
            // with a 404, which is what each of them is to a reader; and like the app's own 404 it is
            // kept for a minute.
            ErrorResponses = new[] { 403, 404 }
                .Select(status => new ErrorResponse
                {
                    HttpStatus = status,
                    ResponseHttpStatus = 404,
                    ResponsePagePath = "/404.html",
                    Ttl = Duration.Minutes(1),
                })
                .ToArray(),
        });

        // A and AAAA at both names, aliases of the distribution: CloudFront is dual-stack, and an
        // alias at the apex is what a CNAME could not be.
        var target = RecordTarget.FromAlias(new CloudFrontTarget(distribution));
        _ = new ARecord(this, "Apex", new ARecordProps { Zone = zone, Target = target });
        _ = new AaaaRecord(this, "ApexV6", new AaaaRecordProps { Zone = zone, Target = target });
        _ = new ARecord(this, "Www", new ARecordProps { Zone = zone, RecordName = "www", Target = target });
        _ = new AaaaRecord(this, "WwwV6", new AaaaRecordProps { Zone = zone, RecordName = "www", Target = target });

        // holding/site, copied beside the built assembly by the project file, as the functions are.
        // Every deploy replaces the bucket's contents with it (a file removed from the folder is
        // removed from the bucket) and then invalidates the whole distribution and waits for that, so
        // the deploy is over when the edge serves the new page.
        _ = new BucketDeployment(this, "Page", new BucketDeploymentProps
        {
            Sources = [Source.Asset(Path.Combine(AppContext.BaseDirectory, "holding"))],
            DestinationBucket = bucket,
            CacheControl = [Amazon.CDK.AWS.S3.Deployment.CacheControl.FromString(FileCacheControl)],
            Distribution = distribution,
            DistributionPaths = ["/*"],
            LogGroup = new LogGroup(this, "PageLogs", new LogGroupProps
            {
                Retention = RetentionDays.TWO_WEEKS,
                RemovalPolicy = RemovalPolicy.DESTROY,
            }),
        });

        _ = new CfnOutput(this, "DistributionId", new CfnOutputProps { Value = distribution.DistributionId });
        // Answers before the records have spread, and redirects to the apex like any other name.
        _ = new CfnOutput(this, "DistributionDomainName", new CfnOutputProps { Value = distribution.DistributionDomainName });
    }

    /// <summary>
    /// The viewer-request function's source, read from beside the built assembly as <c>Edge</c> reads
    /// its own, with the canonical host put in place of its token: the name the function redirects to
    /// is then the one the certificate and the records are made for, written once, in <c>Site</c>.
    /// </summary>
    private static string RequestFunction(Site site)
    {
        const string token = "__CANONICAL_HOST__";
        var source = File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "functions", "holding-request.js"));

        return source.Contains(token, StringComparison.Ordinal)
            ? source.Replace(token, site.Host, StringComparison.Ordinal)
            : throw new InvalidOperationException($"holding-request.js no longer carries {token}: there is no host to redirect to.");
    }
}
