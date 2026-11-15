using Amazon.CDK;
using Amazon.CDK.AWS.CloudWatch;
using Amazon.CDK.AWS.CloudWatch.Actions;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.Events;
using Amazon.CDK.AWS.Events.Targets;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.SNS;
using Constructs;

namespace Infra;

/// <summary>
/// What tells the owner the site is failing: five alarms and a rule, each sent by email through the
/// topic the Alerts stack keeps. They live in the application stack, beside what they watch, because
/// the balancer's metrics are named by the balancer and a resume makes a new one; a parked
/// environment has nothing to alarm about, and has no alarms. Every threshold is set for a small
/// site, where a window holds tens of requests rather than thousands: a rate needs a floor of
/// errors under it, and a percentile a floor of requests, or one bad request pages. See ADR 0080.
/// </summary>
internal sealed class Alarms : Construct
{
    /// <summary>
    /// The category the API writes its IGDB call line under, <c>IgdbCallLogHandler.Category</c>
    /// there. Stated again because this app cannot reference that one, and a test on the server's
    /// side reads this file and fails when the two differ.
    /// </summary>
    private const string IgdbCallCategory = "MyVideoGameList.Server.Observability.IgdbCalls";

    /// <summary>
    /// What a task stopped by hand with this reason is, for the rule: a test, so that the path from
    /// ECS to the inbox can be proved without breaking anything. <c>infra/README.md</c> says how.
    /// </summary>
    private const string TestStopReason = "Alarm test";

    private static readonly Duration Window = Duration.Minutes(5);

    private readonly Site site;
    private readonly SnsAction notify;

    public Alarms(Construct scope, string id, Site site, ApplicationLoadBalancer alb,
        IReadOnlyList<ApplicationTargetGroup> targetGroups, ILogGroup apiLogs)
        : base(scope, id)
    {
        this.site = site;
        var stack = Stack.Of(this);

        var topic = AlertsStack.TopicByName(this, "Topic", site);
        notify = new SnsAction(topic);

        ErrorRate(alb);
        Latency(alb);
        UnhealthyTargets(targetGroups);
        DatabaseConnections();
        IgdbFailureRate(apiLogs);
        TaskStopped(stack, topic);
    }

    /// <summary>
    /// The share of requests answered 5xx, by either process or by the balancer itself: the reader's
    /// view, which the API's own request line cannot give, since the SSR server writes no such line
    /// and the balancer's own failures reach neither.
    /// </summary>
    private void ErrorRate(ApplicationLoadBalancer alb)
    {
        var sum = new MetricOptions { Period = Window, Statistic = Stats.SUM };
        // The balancer's own 5xx, reported only when there are any.
        var balancer = alb.Metrics.HttpCodeElb(HttpCodeElb.ELB_5XX_COUNT, sum);
        var errors = new MathExpression(new MathExpressionProps
        {
            Expression = "FILL(targets, 0) + FILL(balancer, 0)",
            UsingMetrics = new Dictionary<string, IMetric>
            {
                ["targets"] = alb.Metrics.HttpCodeTarget(HttpCodeTarget.TARGET_5XX_COUNT, sum),
                ["balancer"] = balancer,
            },
            Period = Window,
        });
        var errorRate = new MathExpression(new MathExpressionProps
        {
            // The balancer counts a request only once it has chosen a target, so one it answered
            // itself before that, with no target to send it to, is in its 5xx and not in its
            // requests. Adding the two counts twice a 502 or 504 it answered for a target, which
            // can only make the rate read lower than it is.
            Expression = "IF(errors >= 5, 100 * errors / (FILL(requests, 0) + FILL(balancer, 0)), 0)",
            UsingMetrics = new Dictionary<string, IMetric>
            {
                ["errors"] = errors,
                ["requests"] = alb.Metrics.RequestCount(sum),
                ["balancer"] = balancer,
            },
            Period = Window,
            Label = "5xx, % of requests",
        });

        Alarm("5xx-rate", errorRate, threshold: 5, windows: 3, breaching: 2,
            "At least 5% of the requests through the balancer were answered 5xx, five of them at least, "
            + "in two of the last three five-minute windows. Both processes and the balancer's own answers "
            + "count. A 502 from the API is a third party failing, most likely IGDB, whose own alarm says "
            + "so; a 500 is ours. Look in the /mvgl/" + site.Env + "/api and /ssr log groups. ADR 0080.");
    }

    /// <summary>
    /// The 99th percentile of the time the targets took to start answering. On a window of tens of
    /// requests that is the slowest of them, so it needs twenty and three windows running before it
    /// says anything.
    /// </summary>
    private void Latency(ApplicationLoadBalancer alb)
    {
        var latency = new MathExpression(new MathExpressionProps
        {
            Expression = "IF(FILL(requests, 0) >= 20, p99, 0)",
            UsingMetrics = new Dictionary<string, IMetric>
            {
                ["requests"] = alb.Metrics.RequestCount(new MetricOptions { Period = Window, Statistic = Stats.SUM }),
                ["p99"] = alb.Metrics.TargetResponseTime(new MetricOptions { Period = Window, Statistic = Stats.Percentile(99) }),
            },
            Period = Window,
            Label = "p99 response time, seconds",
        });

        Alarm("p99-latency", latency, threshold: 3, windows: 3, breaching: 3,
            "The slowest 1% of requests took three seconds or more to start answering, in each of the last "
            + "three five-minute windows of twenty requests or more. Something is queueing, most likely behind "
            + "IGDB's four-a-second limit on cache misses: the API's log says how long each IGDB call took. "
            + "ADR 0080.");
    }

    /// <summary>
    /// A target the balancer has stopped sending to. ECS replaces such a task, so this is the restart
    /// the rule below cannot name: a process that is up but not answering its health check.
    /// </summary>
    private void UnhealthyTargets(IReadOnlyList<ApplicationTargetGroup> targetGroups)
    {
        var minute = new MetricOptions { Period = Duration.Minutes(1), Statistic = Stats.MAXIMUM };
        var metrics = new Dictionary<string, IMetric>();
        for (var i = 0; i < targetGroups.Count; i++)
        {
            metrics[$"group{i}"] = targetGroups[i].Metrics.UnhealthyHostCount(minute);
        }

        var unhealthy = new MathExpression(new MathExpressionProps
        {
            Expression = string.Join(" + ", metrics.Keys.Select(key => $"FILL({key}, 0)")),
            UsingMetrics = metrics,
            Period = Duration.Minutes(1),
            Label = "unhealthy targets",
        });

        // Any minute at all: the balancer marks a target unhealthy only after consecutive failed
        // checks, and ECS replaces the task soon after, so the state does not last long enough to wait
        // for. A deploy's new target starts as "initial" and its old one drains, and neither should
        // count; the first deploy after this one is the check (ADR 0080).
        Alarm("unhealthy-target", unhealthy, threshold: 1, windows: 1, breaching: 1,
            "A task of the API or the SSR server failed its health checks and the balancer stopped sending "
            + "it requests; ECS replaces it by itself. Once is a blip. Again and again is a process that "
            + "starts and then stops answering: look in its log group for what it wrote last. ADR 0080.");
    }

    /// <summary>
    /// Connections open on the database. A small site holds a handful; the pool allows a hundred per
    /// process, which is more than a micro instance's server accepts, so a leak shows here before it
    /// shows as refused connections.
    /// </summary>
    private void DatabaseConnections()
    {
        var connections = new Metric(new MetricProps
        {
            Namespace = "AWS/RDS",
            MetricName = "DatabaseConnections",
            // By the identifier the Data stack gives the instance, rather than a reference that would
            // add an output to Data and make the next App deploy wait for a Data deploy.
            DimensionsMap = new Dictionary<string, string> { ["DBInstanceIdentifier"] = site.DatabaseIdentifier },
            Period = Window,
            Statistic = Stats.MAXIMUM,
        });

        Alarm("db-connections", connections, threshold: 40, windows: 3, breaching: 3,
            "Forty or more connections were open on the database for fifteen minutes. A quiet site holds a "
            + "handful, and an idle pooled connection closes after five minutes, so this is a leak or a load "
            + "the instance was not sized for; past the server's max_connections, every new one is refused. "
            + "ADR 0080.");
    }

    /// <summary>
    /// The share of the API's calls to IGDB that failed, counted from the one line the API writes for
    /// each call outside its retries. A call the reader gave up on, or that our own limiter refused, is
    /// neither, and is not counted.
    /// </summary>
    private void IgdbFailureRate(ILogGroup apiLogs)
    {
        var failureRate = new MathExpression(new MathExpressionProps
        {
            Expression = "IF(FILL(failed, 0) >= 3, 100 * FILL(failed, 0) / (FILL(failed, 0) + FILL(succeeded, 0)), 0)",
            UsingMetrics = new Dictionary<string, IMetric>
            {
                ["failed"] = IgdbCalls(apiLogs, "IgdbCallsFailed", "failed"),
                ["succeeded"] = IgdbCalls(apiLogs, "IgdbCallsSucceeded", "succeeded"),
            },
            Period = Window,
            Label = "IGDB calls failed, %",
        });

        Alarm("igdb-failure-rate", failureRate, threshold: 10, windows: 3, breaching: 2,
            "At least 10% of the API's calls to IGDB failed, three of them at least, in two of the last three "
            + "five-minute windows. Browsing, search and game pages fail while it lasts; lists and profiles "
            + "render from the cache. If the token request is what fails, the credential in the "
            + "mvgl/" + site.Env + "/igdb secret is the first suspect. ADR 0080.");
    }

    private Metric IgdbCalls(ILogGroup apiLogs, string metricName, string outcome)
    {
        var filter = new MetricFilter(this, metricName, new MetricFilterProps
        {
            LogGroup = apiLogs,
            MetricNamespace = site.MetricNamespace,
            MetricName = metricName,
            FilterPattern = FilterPattern.All(
                FilterPattern.StringValue("$.Category", "=", IgdbCallCategory),
                FilterPattern.StringValue("$.State.Outcome", "=", outcome)),
            MetricValue = "1",
        });

        return filter.Metric(new MetricOptions { Period = Window, Statistic = Stats.SUM });
    }

    /// <summary>
    /// A task of either service that stopped without anybody asking: its essential container exited,
    /// out of memory included, or it never started. An email for each, because with one task to a
    /// service each is an outage of it until the replacement is up. A deploy and a park stop tasks
    /// too, by the scheduler's hand, which should carry neither code; AWS does not say which code
    /// each case gets, so the first deploy after this one is the check (ADR 0080). The tasks are
    /// chosen by their task definitions' families, which this stack names, so the migration task's
    /// exit is not one.
    /// </summary>
    private void TaskStopped(Stack stack, ITopic topic)
    {
        var definitions = $"arn:{Aws.PARTITION}:ecs:{stack.Region}:{stack.Account}:task-definition/{site.Prefix}";
        var rule = new Rule(this, "TaskStopped", new RuleProps
        {
            RuleName = $"{site.Prefix}-task-stopped",
            Description = "A task of the API or the SSR server stopped that nobody stopped (ADR 0080)",
            EventPattern = new EventPattern
            {
                Source = ["aws.ecs"],
                DetailType = ["ECS Task State Change"],
                Detail = new Dictionary<string, object>
                {
                    ["clusterArn"] = new[] { $"arn:{Aws.PARTITION}:ecs:{stack.Region}:{stack.Account}:cluster/{site.ClusterName}" },
                    ["lastStatus"] = new[] { "STOPPED" },
                    ["taskDefinitionArn"] = new object[]
                    {
                        new Dictionary<string, object> { ["prefix"] = $"{definitions}-api:" },
                        new Dictionary<string, object> { ["prefix"] = $"{definitions}-ssr:" },
                    },
                    ["$or"] = new object[]
                    {
                        new Dictionary<string, object> { ["stopCode"] = new[] { "EssentialContainerExited", "TaskFailedToStart" } },
                        new Dictionary<string, object> { ["stoppedReason"] = Match.Prefix(TestStopReason) },
                    },
                },
            },
        });

        rule.AddTarget(new SnsTopic(topic, new SnsTopicProps
        {
            Message = RuleTargetInput.FromText(
                $"MVGL {site.Env}: a task stopped that nobody stopped, and ECS is replacing it. "
                + $"Task definition: {EventField.FromPath("$.detail.taskDefinitionArn")}. "
                + $"Stop code: {EventField.FromPath("$.detail.stopCode")}. "
                + $"Reason: {EventField.FromPath("$.detail.stoppedReason")}. "
                + $"Task: {EventField.FromPath("$.detail.taskArn")}. "
                + $"What it wrote last is in the /mvgl/{site.Env}/api or /ssr log group. ADR 0080."),
        }));
    }

    private void Alarm(string name, IMetric metric, double threshold, int windows, int breaching, string description)
    {
        var alarm = new Alarm(this, name, new AlarmProps
        {
            AlarmName = $"{site.Prefix}-{name}",
            AlarmDescription = description,
            Metric = metric,
            Threshold = threshold,
            ComparisonOperator = ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            EvaluationPeriods = windows,
            DatapointsToAlarm = breaching,
            // No data is no traffic, a stopped database or a quiet log, and none of those is a failure
            // anybody is suffering.
            TreatMissingData = TreatMissingData.NOT_BREACHING,
        });

        // OK as well as ALARM, so that the inbox says when it is over, not only when it began.
        alarm.AddAlarmAction(notify);
        alarm.AddOkAction(notify);
    }
}
