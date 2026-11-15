using Amazon.CDK;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.WAFv2;
using Constructs;

namespace Infra;

/// <summary>
/// The web ACL on the distribution, alone in a stack in <c>us-east-1</c>, the only Region a CloudFront
/// web ACL can be made in. It holds one rule: an address that sends more than
/// <see cref="RequestsPerFiveMinutes"/> requests the rule counts in five minutes is answered 429 until it
/// slows down, so that no one address can spend the four IGDB calls a second the whole site shares
/// (ADR 0098). Everything else is allowed.
/// </summary>
/// <remarks>
/// A stack of its own, beside <c>EdgeCert</c> rather than in it, because it bills by the hour and
/// <c>EdgeCert</c> is long-lived: <c>scripts/dev-env.mjs</c> deploys it just before <c>App</c> on a
/// resume and destroys it after <c>App</c> on a park, since the distribution holds the ACL and AWS WAF
/// refuses to delete an ACL something still uses. The application stack reads its ARN the way it reads
/// the certificate, as a weak cross-region reference, so the pipeline's <c>App</c> deploy needs nothing
/// new; the pipeline never deploys this stack (ADR 0098 §3).
/// </remarks>
public sealed class WafStack : Stack
{
    /// <summary>
    /// How many requests one address may send in <see cref="WindowSeconds"/> before the rule answers 429.
    /// </summary>
    /// <remarks>
    /// Counted from a local run on 2026-11-15 (ADR 0098 §1). What the rule counts is every request but
    /// <see cref="UncountedPrefix"/> and <see cref="UncountedPath"/>: a document, a <c>.data</c>, an
    /// <c>/api/</c> call, the icon.
    /// <list type="bullet">
    /// <item>A game page loaded afresh, signed in: about 13 - the document, eleven API calls, the icon.
    /// The home page: about 11. Any page signed out: about 3.</item>
    /// <item>A move to a game page inside the site: about 6 - its <c>.data</c> and five API calls.</item>
    /// <item>Brisk browsing, a game page every ten seconds: 30 pages x 6 = 180 in five minutes.</item>
    /// <item>Twenty search results opened in tabs at once: 20 x 13 = 260.</item>
    /// <item>Two people behind one address at an ordinary pace, a page every twenty to thirty seconds:
    /// about 180 to 240 between them.</item>
    /// </list>
    /// And the other side: IGDB allows four calls a second, 1,200 in five minutes, for the whole site.
    /// A game page the API has not seen lately costs three (the game, its completion times, its related
    /// games), a browse or a search page one, and anything the edge or the API has kept none. So 300
    /// requests can spend at most 900, and only by asking for nothing but games nobody has looked at:
    /// one call in four is always somebody else's. An office or a school behind one address does not
    /// fit; that is production's question, and #447's load check measures where the budget really runs
    /// out and tunes this.
    /// </remarks>
    public const int RequestsPerFiveMinutes = 300;

    /// <summary>The window the rule counts over, in seconds: AWS WAF's default, and what the limit is written for.</summary>
    public const int WindowSeconds = 300;

    /// <summary>The rule's name, and the name of its metrics, the <c>Rule</c> dimension.</summary>
    public const string RuleName = "requests-per-address";

    /// <summary>The path prefix the rule does not count: the hashed bundles, dozens to a page load.</summary>
    public const string UncountedPrefix = "/assets/";

    /// <summary>
    /// React Router's route manifest, which the rule does not count either. It costs IGDB nothing, and a
    /// refusal of it would be a plain error rather than a 429 the page can tell apart: route discovery
    /// throws <c>Error("429 ")</c> where a <c>.data</c> request throws a route error with the status, so
    /// the page would say something failed on our side (ADR 0098 §1). Left alone, a refused reader's
    /// next move fails on its <c>.data</c>, which says what happened.
    /// </summary>
    public const string UncountedPath = "/__manifest";

    private const string ResponseBodyKey = "rate-limited";

    /// <summary>What the refusal's <c>Retry-After</c> says, in seconds.</summary>
    private const string RetryAfterSeconds = "60";

    /// <summary>
    /// What a refused request is answered with. HTML, because the reader most likely to meet it is a
    /// person, and a person meets it as a page they asked for: twenty tabs opened at once are twenty
    /// documents. The client does not read it: a <c>.data</c> request or an <c>/api/</c> call answered 429
    /// by anything but the API is shown the client's own sentence for it (<c>RATE_LIMITED</c> in
    /// <c>@/lib/api</c>), so nothing here has to be <c>ProblemDetails</c> (ADR 0098 §4). Never a sentence
    /// that says something failed on our side, and nothing loaded from anywhere: it is all inline.
    /// </summary>
    private const string ResponseBody =
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex\">"
        + "<title>Too many requests - MyVideoGameList</title>"
        + "<style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.5}"
        + "body{max-width:34rem;margin:15vh auto;padding:0 1rem}</style></head><body>"
        + "<h1>Too many requests</h1>"
        + "<p>MyVideoGameList has had more requests from your network address in the last few minutes than one "
        + "person browsing would send. Wait a few minutes, then reload the page.</p>"
        + "<p>Several people sharing one connection can do this between them without anybody doing anything wrong.</p>"
        + "</body></html>";

    /// <summary>The ACL's ARN, which the distribution names as its <c>WebACLId</c>.</summary>
    public string WebAclArn { get; }

    public WafStack(Construct scope, string id, IStackProps props, Site site) : base(scope, id, props)
    {
        var acl = new CfnWebACL(this, "WebAcl", new CfnWebACLProps
        {
            Name = site.WebAclName,
            // AWS WAF's pattern for a description admits letters, digits, spaces and + = : # @ / - , . and
            // nothing else: no parentheses, no apostrophe.
            Description = $"One rate-based rule for {site.Host}, ADR 0098",
            Scope = "CLOUDFRONT",
            DefaultAction = new CfnWebACL.DefaultActionProperty { Allow = new CfnWebACL.AllowActionProperty() },
            VisibilityConfig = Visibility(site.WebAclName),
            CustomResponseBodies = new Dictionary<string, object>
            {
                [ResponseBodyKey] = new CfnWebACL.CustomResponseBodyProperty
                {
                    ContentType = "TEXT_HTML",
                    Content = ResponseBody,
                },
            },
            Rules = new object[]
            {
                new CfnWebACL.RuleProperty
                {
                    Name = RuleName,
                    Priority = 0,
                    Action = new CfnWebACL.RuleActionProperty
                    {
                        Block = new CfnWebACL.BlockActionProperty
                        {
                            // 429, not AWS WAF's 403: a 403 says "you may not", which is not true, and
                            // the client knows a 429 for what it is (ADR 0098 §4).
                            CustomResponse = new CfnWebACL.CustomResponseProperty
                            {
                                ResponseCode = 429,
                                CustomResponseBodyKey = ResponseBodyKey,
                                // So that the client waits rather than asking again within seconds: the
                                // navbar's search holds for a 429's Retry-After, up to its own thirty
                                // seconds, and five without one. A minute is a guess at how soon the rate
                                // falls back under the limit; AWS says only that it checks every ten.
                                ResponseHeaders = new object[]
                                {
                                    new CfnWebACL.CustomHTTPHeaderProperty { Name = "Retry-After", Value = RetryAfterSeconds },
                                },
                            },
                        },
                    },
                    Statement = new CfnWebACL.StatementProperty
                    {
                        RateBasedStatement = new CfnWebACL.RateBasedStatementProperty
                        {
                            Limit = RequestsPerFiveMinutes,
                            EvaluationWindowSec = WindowSeconds,
                            // The address the request came from, never X-Forwarded-For: the viewer
                            // writes that header, so keying on it would let every request choose its
                            // own bucket. With the ACL on the distribution itself, that address is the
                            // one that connected to CloudFront: the viewer's, or their network's. AWS
                            // does not say so in as many words; the next resume's burst shows it
                            // (ADR 0098 §5).
                            AggregateKeyType = "IP",
                            // Every request but the bundles and the route manifest.
                            ScopeDownStatement = new CfnWebACL.StatementProperty
                            {
                                NotStatement = new CfnWebACL.NotStatementProperty
                                {
                                    Statement = new CfnWebACL.StatementProperty
                                    {
                                        OrStatement = new CfnWebACL.OrStatementProperty
                                        {
                                            Statements = new object[]
                                            {
                                                PathIs("STARTS_WITH", UncountedPrefix),
                                                PathIs("EXACTLY", UncountedPath),
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    VisibilityConfig = Visibility(RuleName),
                },
            },
        });

        // What the rule refused, for two weeks or until a park, whichever comes first: AWS WAF keeps its
        // sampled requests for three hours, and the address a refusal was for is the one thing worth
        // reading afterwards. The name has to start aws-waf-logs-, and the group has to be in the ACL's
        // Region. Destroyed with the stack, because a resume makes the stack again with the same name.
        var logGroup = new LogGroup(this, "WebAclLog", new LogGroupProps
        {
            LogGroupName = site.WebAclLogGroup,
            Retention = RetentionDays.TWO_WEEKS,
            RemovalPolicy = RemovalPolicy.DESTROY,
        });
        var logging = new CfnLoggingConfiguration(this, "WebAclLogging", new CfnLoggingConfigurationProps
        {
            ResourceArn = acl.AttrArn,
            // The group's ARN in the form AWS WAF's guide gives, ending in the group's name. CDK's
            // LogGroupArn ends in ":*" instead.
            LogDestinationConfigs =
            [
                FormatArn(new ArnComponents
                {
                    Service = "logs",
                    Resource = "log-group",
                    ResourceName = site.WebAclLogGroup,
                    ArnFormat = ArnFormat.COLON_RESOURCE_NAME,
                }),
            ],
            // A refused request's credentials are never written: the basic-auth pair, while the door is
            // on, and the session cookie. Nor its query string, or the Referer that repeats a page's:
            // a search can be an email address, which is why no log line of ours carries either
            // (CLAUDE.md). The path, the address and the rule are what a refusal is read by.
            RedactedFields = new object[]
            {
                new CfnLoggingConfiguration.FieldToMatchProperty { SingleHeader = new Dictionary<string, object> { ["Name"] = "authorization" } },
                new CfnLoggingConfiguration.FieldToMatchProperty { SingleHeader = new Dictionary<string, object> { ["Name"] = "cookie" } },
                new CfnLoggingConfiguration.FieldToMatchProperty { SingleHeader = new Dictionary<string, object> { ["Name"] = "referer" } },
                new CfnLoggingConfiguration.FieldToMatchProperty { QueryString = new Dictionary<string, object>() },
            },
            // Only what a rule blocked or counted: an allowed request is the site working, and logging
            // every one would cost more than the ACL does.
            LoggingFilter = new Dictionary<string, object>
            {
                ["DefaultBehavior"] = "DROP",
                ["Filters"] = new object[]
                {
                    new Dictionary<string, object>
                    {
                        ["Behavior"] = "KEEP",
                        ["Requirement"] = "MEETS_ANY",
                        ["Conditions"] = new object[]
                        {
                            new Dictionary<string, object> { ["ActionCondition"] = new Dictionary<string, object> { ["Action"] = "BLOCK" } },
                            new Dictionary<string, object> { ["ActionCondition"] = new Dictionary<string, object> { ["Action"] = "COUNT" } },
                        },
                    },
                },
            },
        });
        logging.Node.AddDependency(logGroup);

        WebAclArn = acl.AttrArn;

        // For people and scripts, as EdgeCert's CertificateArn is: dev-check.mjs compares it with the
        // distribution's WebACLId. The reference App reads is an output CDK adds beside it.
        _ = new CfnOutput(this, "WebAclArn", new CfnOutputProps { Value = acl.AttrArn });
    }

    /// <summary>A request whose path, as sent, matches <paramref name="value"/> in the way <paramref name="how"/> says.</summary>
    private static CfnWebACL.StatementProperty PathIs(string how, string value) => new()
    {
        ByteMatchStatement = new CfnWebACL.ByteMatchStatementProperty
        {
            FieldToMatch = new CfnWebACL.FieldToMatchProperty { UriPath = new Dictionary<string, object>() },
            PositionalConstraint = how,
            SearchString = value,
            TextTransformations = new object[] { new CfnWebACL.TextTransformationProperty { Priority = 0, Type = "NONE" } },
        },
    };

    /// <summary>Metrics and sampled requests, named after the rule or the ACL.</summary>
    private static CfnWebACL.VisibilityConfigProperty Visibility(string metricName) => new()
    {
        CloudWatchMetricsEnabled = true,
        SampledRequestsEnabled = true,
        MetricName = metricName,
    };
}
