using Amazon.CDK;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.CloudWatch;
using Amazon.CDK.AWS.CloudWatch.Actions;
using Constructs;

namespace Infra;

/// <summary>
/// The alarms on the edge: the share of the distribution's answers that were 5xx, and the viewer-request
/// function throwing (ADR 0110). ADR 0080's alarms watch the balancer, so they see nothing the edge answers
/// by itself: a function that throws, such as the door with no key in its store, or a balancer CloudFront
/// cannot reach.
/// </summary>
/// <remarks>
/// <para>
/// <b>In <c>us-east-1</c>.</b> CloudFront publishes its metrics there, its functions' included, and an alarm
/// watches only a metric in its own Region. They send to the Alerts topic made there, by its name, as the
/// application stack's alarms send to the one in their Region.
/// </para>
/// <para>
/// <b>Disposable, as the application stack is.</b> The distribution's metrics are named by its id, which a
/// resume makes anew, so this stack reads it from that one, as a weak cross-region reference, and
/// <c>dev-env.mjs</c> deploys it after <c>App</c> on a resume and destroys it before <c>App</c> on a park. The
/// pipeline never deploys it: its <c>App</c> deploy updates the distribution and keeps its id.
/// <c>dev-check.mjs</c> says when the alarm names any other distribution than the stack's.
/// </para>
/// </remarks>
public sealed class EdgeAlarmsStack : Stack
{
    private const string Namespace = "AWS/CloudFront";

    /// <summary>The <c>Region</c> dimension of every CloudFront metric.</summary>
    private const string Global = "Global";

    private static readonly Duration Window = Duration.Minutes(5);

    public EdgeAlarmsStack(Construct scope, string id, IStackProps props, Site site, IDistribution distribution)
        : base(scope, id, props)
    {
        var notify = new SnsAction(AlertsStack.TopicByName(this, "Topic", site));

        ErrorRate(site, notify, distribution);
        if (site.ViewerRequestRuns)
        {
            FunctionErrors(site, notify);
        }
    }

    /// <summary>
    /// The share of the distribution's answers that were 5xx, whoever answered: the origin, CloudFront for an
    /// origin it could not reach, or CloudFront for a function that failed. The first is the balancer's 5xx
    /// rate seen again, and the alarm on that says so first; the others reach no alarm of ADR 0080's.
    /// </summary>
    private void ErrorRate(Site site, SnsAction notify, IDistribution distribution)
    {
        var dimensions = new Dictionary<string, string>
        {
            ["DistributionId"] = distribution.DistributionId,
            ["Region"] = Global,
        };
        var rate = new MathExpression(new MathExpressionProps
        {
            // The rate's Average is a percentage of the window's requests, so the rate times the requests is
            // the count of 5xx; a rate needs a floor of five of them under it, as ADR 0080's has. Measured on
            // dev's distribution: the rate's sample count is the Requests sum, so its Average over a window
            // weights every request alike, not every minute, and the product was the exact count in every
            // window of four hours (ADR 0110). Written as 4.5, because a product of exactly five came out a
            // hair under it there, and `>= 5` read it as four.
            Expression = "IF(FILL(rate, 0) * FILL(requests, 0) / 100 >= 4.5, rate, 0)",
            UsingMetrics = new Dictionary<string, IMetric>
            {
                ["rate"] = Metric("5xxErrorRate", dimensions, Stats.AVERAGE),
                ["requests"] = Metric("Requests", dimensions, Stats.SUM),
            },
            Period = Window,
            Label = "5xx at the edge, % of requests",
        });

        Alarms.Add(this, site, notify, "edge-5xx-rate", rate, threshold: 5, windows: 3, breaching: 2,
            "At least 5% of the requests to the distribution were answered 5xx, five of them at least, in two of "
            + "the last three five-minute windows. If the balancer's own 5xx alarm fired too, the processes are "
            + "failing and their logs say why. If it did not, the edge answered by itself: a function that failed, "
            + "whose own alarm says so where there is one, or a balancer CloudFront could not reach. ADR 0110.");
    }

    /// <summary>
    /// The viewer-request function throwing. It is ours and small, and on every behaviour, before the cache,
    /// so an error is a fault, never a blip, and each is a reader answered with an error. The case that
    /// matters is the door with no key in its store: the function fails closed on every request.
    /// </summary>
    private void FunctionErrors(Site site, SnsAction notify)
    {
        var errors = Metric("FunctionExecutionErrors", new Dictionary<string, string>
        {
            ["FunctionName"] = site.ViewerRequestFunctionName,
            ["Region"] = Global,
        }, Stats.SUM);

        Alarms.Add(this, site, notify, "edge-function-errors", errors, threshold: 1, windows: 1, breaching: 1,
            $"The viewer-request function, {site.ViewerRequestFunctionName}, threw, and CloudFront answered that "
            + "request with an error rather than the page. If it is every request, the basic-auth key is the first "
            + "suspect: the function throws when the store has none (infra/README.md, The edge). ADR 0110.");
    }

    private static Metric Metric(string name, Dictionary<string, string> dimensions, string statistic) => new(new MetricProps
    {
        Namespace = Namespace,
        MetricName = name,
        DimensionsMap = dimensions,
        Period = Window,
        Statistic = statistic,
    });
}
