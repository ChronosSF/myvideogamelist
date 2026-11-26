using System.Globalization;
using System.Text.Json;
using Amazon.CDK;
using Amazon.CDK.AWS.CE;
using Amazon.CDK.AWS.SSM;
using Constructs;

namespace Infra;

/// <summary>
/// Where the money goes, by service: AWS Cost Anomaly Detection, with one monitor of the account's
/// spending per AWS service and a daily email of what it finds, to the address the alarms go to
/// (ADR 0111). The budget alerts say the total is high; this says which service made it so.
/// </summary>
/// <remarks>
/// <para>
/// <b>One account, one stack.</b> An account may hold one AWS-managed monitor of its services, so each
/// environment's account has this stack once, beside its Alerts stack in the same Region. Deployed by
/// hand, by name, and never by the pipeline; long-lived, and not protected, since it holds nothing a
/// deploy would not make again.
/// </para>
/// <para>
/// <b>Daily, by email.</b> An email subscriber may only have a daily or a weekly summary; an alert per
/// anomaly needs an SNS topic. Detection itself runs about three times a day on Cost Explorer's data,
/// which is up to a day behind, so a day's summary loses little.
/// </para>
/// <para>
/// <b>Free</b>, by AWS's own account of it. The address is read from the parameter the Alerts stack
/// reads, so it is in no template and in the repository nowhere.
/// </para>
/// </remarks>
public sealed class CostsStack : Stack
{
    /// <summary>
    /// The smallest anomaly worth an email: its total impact, in dollars, as Cost Anomaly Detection
    /// reports it. An awake dev is about $80 a month, under $3 a day, so $5 is a day or two of something
    /// nobody meant to be running. A number to be moved once the first months are seen.
    /// </summary>
    public const int ImpactDollars = 5;

    public CostsStack(Construct scope, string id, IStackProps props, Site site)
        : base(scope, id, props)
    {
        var monitor = new CfnAnomalyMonitor(this, "Services", new CfnAnomalyMonitorProps
        {
            MonitorName = $"{site.Prefix}-services",
            // What AWS's quotas call an AWS managed monitor for AWS services: each service watched apart.
            MonitorType = "DIMENSIONAL",
            MonitorDimension = "SERVICE",
        });

        _ = new CfnAnomalySubscription(this, "Daily", new CfnAnomalySubscriptionProps
        {
            SubscriptionName = $"{site.Prefix}-services-daily",
            MonitorArnList = [monitor.AttrMonitorArn],
            Frequency = "DAILY",
            Subscribers = new object[]
            {
                new CfnAnomalySubscription.SubscriberProperty
                {
                    Type = "EMAIL",
                    Address = StringParameter.ValueForStringParameter(this, site.AlarmEmailParameter),
                },
            },
            ThresholdExpression = JsonSerializer.Serialize(new Dictionary<string, object>
            {
                ["Dimensions"] = new Dictionary<string, object>
                {
                    ["Key"] = "ANOMALY_TOTAL_IMPACT_ABSOLUTE",
                    ["MatchOptions"] = new[] { "GREATER_THAN_OR_EQUAL" },
                    ["Values"] = new[] { ImpactDollars.ToString(CultureInfo.InvariantCulture) },
                },
            }),
        });

        _ = new CfnOutput(this, "MonitorArn", new CfnOutputProps { Value = monitor.AttrMonitorArn });
    }
}
