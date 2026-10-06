using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudFront.Origins;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Constructs;

namespace Infra;

/// <summary>
/// CloudFront in front of the balancer: one origin, and the distribution decides only what is cached
/// and what is forwarded; the balancer goes on routing between the two processes. What each setting
/// is for is ADR 0044's "CloudFront, and what it may believe"; what this phase added is ADR 0046.
/// Part of the application stack, because its origin is the balancer that stack creates and destroys.
/// </summary>
public sealed class Edge : Construct
{
    public Distribution Distribution { get; }

    public Edge(Construct scope, string id, Site site, ApplicationLoadBalancer alb, ICertificate certificate,
        IKeyValueStore basicAuthStore, string originVerifyValue)
        : base(scope, id)
    {
        var origin = new LoadBalancerV2Origin(alb, new LoadBalancerV2OriginProps
        {
            ProtocolPolicy = OriginProtocolPolicy.HTTPS_ONLY,
            OriginSslProtocols = [OriginSslPolicy.TLS_V1_2],
            // Sixty rather than the default thirty: the API's own ceiling on an IGDB call is thirty
            // seconds (ADR 0034), and the reader should get the API's 502 that says what happened,
            // not CloudFront's 504 cutting in at the same moment.
            ReadTimeout = Duration.Seconds(60),
            // How the balancer knows a request came through this distribution and not through some
            // other (ADR 0046): its listener's rules require the header, and its default action is
            // a 403. The value is a Secrets Manager dynamic reference, resolved by CloudFormation.
            CustomHeaders = new Dictionary<string, string> { [site.OriginVerifyHeader] = originVerifyValue },
        });

        // Basic auth on every behaviour - the default included, since a behaviour without it is an
        // open door - and on the viewer request, before the cache is consulted, so cached pages are
        // behind it too. The credential is read from the store; it is nowhere in the repository.
        var basicAuth = new Function(this, "BasicAuth", new FunctionProps
        {
            FunctionName = $"{site.Prefix}-basic-auth",
            Runtime = FunctionRuntime.JS_2_0,
            KeyValueStore = basicAuthStore,
            Code = FunctionCode.FromFile(new FileCodeOptions
            {
                FilePath = Path.Combine(AppContext.BaseDirectory, "functions", "basic-auth.js"),
            }),
            Comment = $"HTTP basic authentication for {site.Host}; the expected Authorization value is the store's basic-auth key",
        });
        FunctionAssociation[] onEveryBehaviour =
        [
            new FunctionAssociation { EventType = FunctionEventType.VIEWER_REQUEST, Function = basicAuth },
        ];

        // One cache policy for every cached page. The managed policies do not fit: CachingOptimized
        // has a minimum TTL of one second, and any minimum above zero makes CloudFront cache a
        // response the origin marked `private, no-store` - the root's fail-closed default (ADR 0013)
        // depends on a minimum of 0 - and the UseOriginCacheControlHeaders pair put every cookie in
        // the cache key, which gives each signed-in reader a private copy of a public page.
        var pages = new CachePolicy(this, "Pages", new CachePolicyProps
        {
            CachePolicyName = $"{site.Prefix}-pages",
            Comment = "Every cached page: the origin's Cache-Control decides, and only the query strings the pages read are in the key",
            // 0 is the only minimum at which no-store and private are honoured; 0 by default, so a
            // response that states no policy is not cached; a year at most, so CloudFront can serve
            // stale for the whole of the game page's day of stale-while-revalidate.
            MinTtl = Duration.Seconds(0),
            DefaultTtl = Duration.Seconds(0),
            MaxTtl = Duration.Days(365),
            // 0032's six browse parameters, `page` for a public profile, and React Router's
            // `_routes`, which a .data request carries once a route opts out of revalidation.
            QueryStringBehavior = CacheQueryStringBehavior.AllowList("search", "sort", "platform", "genre", "year", "minScore", "page", "_routes"),
            // The server render reads no cookie and no header.
            HeaderBehavior = CacheHeaderBehavior.None(),
            CookieBehavior = CacheCookieBehavior.None(),
            EnableAcceptEncodingGzip = true,
            EnableAcceptEncodingBrotli = true,
        });

        // The balancer's certificate is for the site's name, not for the balancer's own, and
        // CloudFront accepts an origin certificate that matches either the origin domain or the
        // forwarded Host - so every behaviour forwards Host, and one that forgot would answer 502.
        // No managed policy forwards only Host. Whatever is in the cache key travels as well.
        var hostOnly = new OriginRequestPolicy(this, "HostOnly", new OriginRequestPolicyProps
        {
            OriginRequestPolicyName = $"{site.Prefix}-host-only",
            Comment = "The Host header and nothing else; the cache key's query strings travel as well",
            HeaderBehavior = OriginRequestHeaderBehavior.AllowList("Host"),
            CookieBehavior = OriginRequestCookieBehavior.None(),
            QueryStringBehavior = OriginRequestQueryStringBehavior.None(),
        });

        BehaviorOptions Behaviour(ICachePolicy cache, IOriginRequestPolicy originRequest, AllowedMethods? methods = null) => new()
        {
            Origin = origin,
            ViewerProtocolPolicy = ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            AllowedMethods = methods ?? AllowedMethods.ALLOW_GET_HEAD,
            CachePolicy = cache,
            OriginRequestPolicy = originRequest,
            FunctionAssociations = onEveryBehaviour,
        };

        // Nothing per-user is cached, by an explicit behaviour rather than by the origin's header
        // alone (ADR 0013), with every viewer header, cookie and query string forwarded. The patterns
        // end in `*` with no slash before it, because React Router 8 asks for `/lists.data`, not
        // `/lists/...`: with a slash, the .data request would fall through to the cached default.
        var uncached = Behaviour(CachePolicy.CACHING_DISABLED, OriginRequestPolicy.ALL_VIEWER);
        var behaviours = new Dictionary<string, IBehaviorOptions>
        {
            // Every write goes here, and this is the one behaviour that allows anything but GET and
            // HEAD. AllViewer is what carries X-MVGL-Request across (ADR 0033): without it every
            // write is a 403 that looks like an application bug. No CORS policy, here or anywhere.
            ["/api/*"] = Behaviour(CachePolicy.CACHING_DISABLED, OriginRequestPolicy.ALL_VIEWER, AllowedMethods.ALLOW_ALL),
            // The hashed bundles, which react-router-serve sends immutable for a year.
            ["/assets/*"] = Behaviour(CachePolicy.CACHING_OPTIMIZED, hostOnly),
            ["/lists*"] = uncached,
            ["/wishlist*"] = uncached,
            ["/user*"] = uncached,
            ["/news*"] = uncached,
            ["/import*"] = uncached,
            ["/admin*"] = uncached,
        };

        Distribution = new Distribution(this, "Distribution", new DistributionProps
        {
            Comment = site.Host,
            DomainNames = [site.Host],
            Certificate = certificate,
            MinimumProtocolVersion = SecurityPolicyProtocol.TLS_V1_2_2021,
            HttpVersion = HttpVersion.HTTP2_AND_3,
            PriceClass = PriceClass.PRICE_CLASS_100,
            // `/`, `/games`, `/games/{id}`, `/u/*`, robots.txt, the sitemaps, every 404, and their
            // .data forms: each cached for exactly what @/lib/cache says, and nothing else.
            DefaultBehavior = Behaviour(pages, hostOnly),
            AdditionalBehaviors = behaviours,
            // For a cached behaviour CloudFront keeps a 404, a 414 and the 500 to 504 family for at
            // least an "error caching minimum TTL" of ten seconds, whatever the origin said - so a
            // `private, no-store` 502 would be served from the edge for ten seconds, against the
            // rule that caching a failure outlives the failure. 0 for the server errors, and nothing
            // else changes: no error page, no status rewrite. 404 is left alone: the origin gives it
            // s-maxage=60, and it must stay a real 404.
            ErrorResponses = new[] { 500, 502, 503, 504 }
                .Select(status => new ErrorResponse { HttpStatus = status, Ttl = Duration.Seconds(0) })
                .ToArray(),
        });
    }
}
