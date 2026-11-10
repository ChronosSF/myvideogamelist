using Amazon.CDK;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.SES;
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

    public EmailStack(Construct scope, string id, IStackProps props, Site sender)
        : base(scope, id, props)
    {
        SendingConfiguration();

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
    private void SendingConfiguration()
    {
        var configurationSet = new ConfigurationSet(this, "ConfigurationSet", new ConfigurationSetProps
        {
            ConfigurationSetName = Site.EmailConfigurationSet,
            SuppressionReasons = SuppressionReasons.BOUNCES_AND_COMPLAINTS,
        });

        configurationSet.AddEventDestination("BouncesAndComplaints", new ConfigurationSetEventDestinationOptions
        {
            ConfigurationSetEventDestinationName = "bounces-and-complaints",
            Destination = EventDestination.SnsTopic(
                AlertsStack.TopicByName(this, "Alerts", new Site(Site.Production))),
            Events = [EmailSendingEvent.BOUNCE, EmailSendingEvent.COMPLAINT],
        });
    }
}
