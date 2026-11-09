using Amazon.CDK;
using Amazon.CDK.AWS.IAM;
using Constructs;

namespace Infra;

/// <summary>
/// In the production account: the role another environment's API sends email as, through
/// production's SES. Deployed by hand, by name, as the holding page is; no pipeline reaches this
/// account (ADR 0066, 0088).
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
/// <b>Allowed one thing:</b> SES's <c>SendEmail</c> on the domain's identity, from one address. Every
/// email, its bounces and its complaints count against production's reputation, so nothing that
/// assumes this can send as anybody else, or do anything but send.
/// </para>
/// </remarks>
public sealed class EmailStack : Stack
{
    public EmailStack(Construct scope, string id, IStackProps props, Site sender)
        : base(scope, id, props)
    {
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

        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "SendFromNoReply",
            Actions = ["ses:SendEmail"],
            Resources = [$"arn:{Aws.PARTITION}:ses:{Region}:{Account}:identity/{Site.Domain}"],
            Conditions = new Dictionary<string, object>
            {
                ["StringEquals"] = new Dictionary<string, object> { ["ses:FromAddress"] = Site.EmailFromAddress },
            },
        }));

        _ = new CfnOutput(this, "RoleArn", new CfnOutputProps { Value = role.RoleArn });
    }
}
