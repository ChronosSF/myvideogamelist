using Amazon.CDK;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.SNS;
using Amazon.CDK.AWS.SNS.Subscriptions;
using Amazon.CDK.AWS.SSM;
using Constructs;

namespace Infra;

/// <summary>
/// Where an alarm is sent: one topic, and the owner's subscription to it by email. Long-lived and
/// apart from the alarms, because an email subscription is confirmed by a person clicking a link,
/// and the application stack the alarms live in is destroyed and made again on every park and
/// resume (ADR 0080). Deployed by hand, by name, as Data is; the pipeline never touches it. In the
/// production account it is also where SES sends each bounce and complaint (ADR 0091).
/// </summary>
public sealed class AlertsStack : Stack
{
    public AlertsStack(Construct scope, string id, IStackProps props, Site site)
        : base(scope, id, props)
    {
        // Named, because the alarms find it by its name rather than by a cross-stack reference: an
        // App deploy then never waits on an output of this stack, and destroying and redeploying it
        // reconnects every alarm already standing.
        var topic = new Topic(this, "Topic", new TopicProps
        {
            TopicName = site.AlertsTopicName,
            DisplayName = $"MVGL {site.Env}",
        });

        // The address is in Parameter Store, set by hand before the first deploy, because the
        // repository is public. It is a CloudFormation parameter of the SSM type, so CloudFormation
        // reads it on every deploy, the CLI never skips one as unchanged, and a deploy while the
        // parameter is missing fails rather than subscribing nobody. A new address is a new
        // subscription, confirmed again.
        topic.AddSubscription(new EmailSubscription(
            StringParameter.ValueForStringParameter(this, site.AlarmEmailParameter)));

        // A topic policy replaces the default one, so it names everything that publishes: this
        // environment's alarms, and its rule on tasks that stop. Each by its own name prefix, so
        // nothing else in the account or outside it can write to the owner's inbox through here.
        topic.AddToResourcePolicy(Publisher("Alarms", "cloudwatch.amazonaws.com",
            $"arn:{Aws.PARTITION}:cloudwatch:{Region}:{Account}:alarm:{site.Prefix}-*", topic));
        topic.AddToResourcePolicy(Publisher("TaskStoppedRule", "events.amazonaws.com",
            $"arn:{Aws.PARTITION}:events:{Region}:{Account}:rule/{site.Prefix}-*", topic));

        // In the production account, SES as well: the configuration set every email is sent under
        // publishes each bounce and complaint here, the dev environment's included, since its sends
        // are this account's (ADR 0091).
        if (site.IsProduction)
        {
            topic.AddToResourcePolicy(Publisher("EmailEvents", "ses.amazonaws.com", EmailStack.ConfigurationSetArn, topic));
        }

        _ = new CfnOutput(this, "TopicArn", new CfnOutputProps { Value = topic.TopicArn });
    }

    /// <summary>
    /// The topic as another stack finds it: by its name, in that stack's own account and Region, never
    /// by a reference. A reference would make every deploy of that stack, the pipeline's App deploys
    /// included, wait on an output of a stack only the owner deploys, and fail until it exists (ADR
    /// 0080).
    /// </summary>
    internal static ITopic TopicByName(Construct scope, string id, Site site)
    {
        var stack = Stack.Of(scope);
        return Topic.FromTopicArn(scope, id,
            $"arn:{Aws.PARTITION}:sns:{stack.Region}:{stack.Account}:{site.AlertsTopicName}");
    }

    private PolicyStatement Publisher(string sid, string service, string sourceArn, Topic topic) =>
        new(new PolicyStatementProps
        {
            Sid = sid,
            Principals = [new ServicePrincipal(service)],
            Actions = ["sns:Publish"],
            Resources = [topic.TopicArn],
            Conditions = new Dictionary<string, object>
            {
                ["StringEquals"] = new Dictionary<string, object> { ["aws:SourceAccount"] = Account },
                ["ArnLike"] = new Dictionary<string, object> { ["aws:SourceArn"] = sourceArn },
            },
        });
}
