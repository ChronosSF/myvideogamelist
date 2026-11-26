using Amazon.CDK;
using Amazon.CDK.AWS.CloudWatch;
using Amazon.CDK.AWS.CloudWatch.Actions;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.SES;
using Amazon.CDK.AWS.SNS;
using Constructs;

namespace Infra;

/// <summary>
/// In the production account: the configuration set every email is sent under, and the role another
/// environment's API sends email as, through production's SES. Deployed by hand, by name, as the
/// holding page is; no pipeline reaches this account (ADR 0066, 0088, 0091).
/// </summary>
/// <remarks>
/// <para>
/// SES's production access is per account, and production's is the one granted. SES's own sending
/// authorization would not let another account use it: a delegate sender's account has to leave the
/// sandbox itself. So the other environment assumes this role, and its sends are production's.
/// </para>
/// <para>
/// <b>Trusted by one role, by its name.</b> The trust is the sender's account with a condition on the
/// caller's ARN, rather than that role as the principal: IAM turns a role principal into the role's
/// unique id when the policy is saved, and a park and a resume recreate the task role under the same
/// name with a new id, which would leave this trusting a role that no longer exists.
/// </para>
/// <para>
/// <b>Allowed one thing:</b> SES's <c>SendEmail</c> on the domain's identity, from one address, under
/// the configuration set. Every email, its bounces and its complaints count against production's
/// reputation, so nothing that assumes this can send as anybody else, or do anything but send.
/// </para>
/// </remarks>
public sealed class EmailStack : Stack
{
    /// <summary>
    /// The configuration set every email is sent under, which SES publishes its events as, and which a
    /// sender is authorized against beside the identity (ADR 0091).
    /// </summary>
    internal static string ConfigurationSetArn =>
        $"arn:{Aws.PARTITION}:ses:{Site.EmailRegion}:{Site.ProductionAccount}:configuration-set/{Site.EmailConfigurationSet}";

    /// <summary>
    /// What any role that sends email may do: SES's <c>SendEmail</c> on the domain's identity, under
    /// the configuration set, from one address. Granted to the role here and to production's own task
    /// role in the App stack, so that the two are held to the same terms by construction (ADR 0088).
    /// </summary>
    internal static PolicyStatement SendFromNoReply() => new(new PolicyStatementProps
    {
        Sid = "SendFromNoReply",
        Actions = ["ses:SendEmail"],
        Resources =
        [
            $"arn:{Aws.PARTITION}:ses:{Site.EmailRegion}:{Site.ProductionAccount}:identity/{Site.Domain}",
            ConfigurationSetArn,
        ],
        Conditions = new Dictionary<string, object>
        {
            ["StringEquals"] = new Dictionary<string, object> { ["ses:FromAddress"] = Site.EmailFromAddress },
        },
    });

    /// <summary>
    /// The bounce rate at which AWS places an account under review, as SES publishes it: a fraction, 0.05
    /// for 5%. It may pause sending at twice that (ADR 0091, 0111).
    /// </summary>
    internal const double BounceRateReviewed = 0.05;

    /// <summary>The complaint rate at which AWS places an account under review: 0.1%, as 0.001.</summary>
    internal const double ComplaintRateReviewed = 0.001;

    public EmailStack(Construct scope, string id, IStackProps props, Site sender)
        : base(scope, id, props)
    {
        // Production's Alerts topic, by its name, in this account and Region (ADR 0080, 0091).
        var production = new Site(Site.Production);
        var alerts = AlertsStack.TopicByName(this, "Alerts", production);

        SendingConfiguration(alerts);
        ReputationAlarms(production, alerts);

        var taskRole = $"arn:{Aws.PARTITION}:iam::{sender.Account}:role/{sender.ApiTaskRoleName}";

        var role = new Role(this, "Role", new RoleProps
        {
            RoleName = sender.EmailRoleName,
            Description = $"Assumed by the {sender.Env} environment's API to send email through this account's SES",
            MaxSessionDuration = Duration.Hours(1),
            AssumedBy = new AccountPrincipal(sender.Account).WithConditions(new Dictionary<string, object>
            {
                ["ArnEquals"] = new Dictionary<string, object> { ["aws:PrincipalArn"] = taskRole },
            }),
        });

        role.AddToPolicy(SendFromNoReply());

        _ = new CfnOutput(this, "RoleArn", new CfnOutputProps { Value = role.RoleArn });
    }

    /// <summary>
    /// The configuration set every send names, by the API's constant: it sends nothing to an address
    /// that has bounced or complained, and publishes each bounce and complaint to the owner (ADR 0091).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Suppression is the account's default already</b>, for both reasons, in an account opened after
    /// November 2019. Said again here so that the promise made to AWS for production access is kept by
    /// a template, where a change to it is a diff somebody reviews, rather than by an account setting no
    /// template holds. The list itself is the account's: an address one environment's send put on it
    /// is sent nothing by the other.
    /// </para>
    /// <para>
    /// <b>The events go to the Alerts topic, by its name</b>, as the alarms do, so the owner reads them
    /// where the alarms arrive (ADR 0080). Its stack has to be deployed first: SES publishes as itself,
    /// and the topic's policy is what admits it.
    /// </para>
    /// </remarks>
    private void SendingConfiguration(ITopic alerts)
    {
        var configurationSet = new ConfigurationSet(this, "ConfigurationSet", new ConfigurationSetProps
        {
            ConfigurationSetName = Site.EmailConfigurationSet,
            SuppressionReasons = SuppressionReasons.BOUNCES_AND_COMPLAINTS,
        });

        configurationSet.AddEventDestination("BouncesAndComplaints", new ConfigurationSetEventDestinationOptions
        {
            ConfigurationSetEventDestinationName = "bounces-and-complaints",
            Destination = EventDestination.SnsTopic(alerts),
            Events = [EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT],
        });
    }

    /// <summary>
    /// The account's bounce and complaint rates, each alarmed at half the level at which AWS reviews the
    /// account, so that the owner hears of a climb before AWS acts on it (ADR 0111, amending 0091 §4).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>The account's rates, not the configuration set's.</b> SES publishes both, the set's under the
    /// <c>ses:configuration-set</c> dimension. The account's, with no dimension, are what AWS reviews, and
    /// they count every send from this account, dev's included.
    /// </para>
    /// <para>
    /// <b>Missing data keeps the state</b>, as SES's guide on these alarms recommends. SES publishes a rate
    /// only around sends, so an hour with none says nothing new: an alarm that is on stays on until a send
    /// shows the rate back under the line, and one that is OK is not made to say so again.
    /// </para>
    /// </remarks>
    private void ReputationAlarms(Site production, ITopic alerts)
    {
        var notify = new SnsAction(alerts);

        RateAlarm(production, notify, "ses-bounce-rate", "Reputation.BounceRate", BounceRateReviewed / 2,
            "SES's bounce rate for the production account reached 2.5%, half the 5% at which AWS places the account "
            + "under review; at 10% it may pause sending, and every email of both environments goes through this "
            + "account. Each bounce is already in this inbox, from the configuration set: a run of them from one "
            + "form is the sign-up being fed bad addresses. The rate is over SES's representative volume of mail, "
            + "not a fixed period. ADR 0111.");
        RateAlarm(production, notify, "ses-complaint-rate", "Reputation.ComplaintRate", ComplaintRateReviewed / 2,
            "SES's complaint rate for the production account reached 0.05%, half the 0.1% at which AWS places the "
            + "account under review; at 0.5% it may pause sending, and every email of both environments goes "
            + "through this account. Each complaint is already in this inbox, from the configuration set, naming "
            + "the address that marked an email as spam. ADR 0111.");
    }

    private void RateAlarm(Site production, SnsAction notify, string name, string metricName, double threshold, string description)
    {
        var alarm = new Alarm(this, name, new AlarmProps
        {
            AlarmName = $"{production.Prefix}-{name}",
            AlarmDescription = description,
            // No dimension: the account's own rate, which is the one AWS reviews.
            Metric = new Metric(new MetricProps
            {
                Namespace = "AWS/SES",
                MetricName = metricName,
                Period = Duration.Hours(1),
                Statistic = Stats.MAXIMUM,
            }),
            Threshold = threshold,
            ComparisonOperator = ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
            EvaluationPeriods = 1,
            DatapointsToAlarm = 1,
            TreatMissingData = TreatMissingData.IGNORE,
        });

        // OK as well as ALARM, so that the inbox says when it is over, as every alarm of ours does (ADR 0080).
        alarm.AddAlarmAction(notify);
        alarm.AddOkAction(notify);
    }
}
