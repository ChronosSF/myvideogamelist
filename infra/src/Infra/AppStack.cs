using Amazon.CDK;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ECS;
using Amazon.CDK.AWS.ElasticLoadBalancingV2;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.Route53.Targets;
using Amazon.CDK.AWS.ServiceDiscovery;
using Constructs;

namespace Infra;

/// <summary>
/// The disposable stack: the balancer, both services, their log groups and the DNS alias. Destroying
/// it is the pause lever that matters, because the balancer, not the containers, is what an idle
/// environment pays for (ADR 0044). Milestone 1 is this stack behind the balancer alone; CloudFront
/// joins it in milestone 2.
/// </summary>
public sealed class AppStack : Stack
{
    private const string Production = "Production";

    public AppStack(Construct scope, string id, IStackProps props, Site site, IHostedZone zone, DataStack data, string imageTag)
        : base(scope, id, props)
    {
        var albSubnets = data.Vpc.SelectSubnets(new SubnetSelection { SubnetGroupName = "alb" });
        var taskSubnets = new SubnetSelection { SubnetGroupName = "tasks" };

        var apiService = Service(site, data, "api", ApiTask(site, data, albSubnets, imageTag), data.ApiSecurityGroup, taskSubnets, registerInNamespace: true);
        var ssrService = Service(site, data, "ssr", SsrTask(site, data, imageTag), data.SsrSecurityGroup, taskSubnets, registerInNamespace: false);

        var alb = new ApplicationLoadBalancer(this, "Alb", new ApplicationLoadBalancerProps
        {
            LoadBalancerName = $"{site.Prefix}-alb",
            Vpc = data.Vpc,
            InternetFacing = true,
            SecurityGroup = data.AlbSecurityGroup,
            VpcSubnets = new SubnetSelection { SubnetGroupName = "alb" },
            IdleTimeout = Duration.Seconds(60),
        });

        // Thirty seconds rather than the default three hundred, or every deploy waits five minutes
        // for the old task to drain.
        var apiTargets = TargetGroup("Api", data, 8080, "/healthz");
        var ssrTargets = TargetGroup("Ssr", data, 3000, "/robots.txt");
        apiTargets.AddTarget(apiService);
        ssrTargets.AddTarget(ssrService);

        // Plain HTTP is redirected here, by the balancer; the API never redirects (ADR 0044).
        alb.AddRedirect();

        var https = alb.AddListener("Https", new BaseApplicationListenerProps
        {
            Port = 443,
            Certificates = [ListenerCertificate.FromCertificateManager(data.Certificate)],
            DefaultTargetGroups = [ssrTargets],
        });
        https.AddTargetGroups("Api", new AddApplicationTargetGroupsProps
        {
            Priority = 10,
            Conditions = [ListenerCondition.PathPatterns(["/api/*"])],
            TargetGroups = [apiTargets],
        });
        // Not under /api/, so without this rule they would reach the SSR server and 404. Exposed in
        // dev; production decides again, because each /readyz is an IGDB call open to anyone (D-5).
        https.AddTargetGroups("Health", new AddApplicationTargetGroupsProps
        {
            Priority = 20,
            Conditions = [ListenerCondition.PathPatterns(["/healthz", "/readyz"])],
            TargetGroups = [apiTargets],
        });

        // The hostname is the zone's own name, so the alias sits at the zone apex. Milestone 2
        // points it at CloudFront instead.
        _ = new ARecord(this, "Alias", new ARecordProps
        {
            Zone = zone,
            Target = RecordTarget.FromAlias(new LoadBalancerTarget(alb)),
        });
        _ = new AaaaRecord(this, "AliasIpv6", new AaaaRecordProps
        {
            Zone = zone,
            Target = RecordTarget.FromAlias(new LoadBalancerTarget(alb)),
        });

        _ = new CfnOutput(this, "LoadBalancerDnsName", new CfnOutputProps { Value = alb.LoadBalancerDnsName });
        _ = new CfnOutput(this, "ApiTargetGroupArn", new CfnOutputProps { Value = apiTargets.TargetGroupArn });
        _ = new CfnOutput(this, "SsrTargetGroupArn", new CfnOutputProps { Value = ssrTargets.TargetGroupArn });
    }

    private FargateTaskDefinition ApiTask(Site site, DataStack data, ISelectedSubnets albSubnets, string imageTag)
    {
        var task = Task(site, "api");

        // The ring that signs the cookie lives in Parameter Store under this path, and this is the
        // only thing the task role may do: read and write beneath it (ADR 0043). The repository is
        // built on the first protect, not at boot, so a wrong policy fails the first sign-in.
        var parameterArn = $"arn:{Aws.PARTITION}:ssm:{Region}:{Account}:parameter{site.DataProtectionPath}";
        task.TaskRole.AddToPrincipalPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "DataProtectionKeyRing",
            Actions = ["ssm:GetParametersByPath", "ssm:PutParameter"],
            Resources = [parameterArn, $"{parameterArn}/*"],
        }));

        task.AddContainer("api", new ContainerDefinitionOptions
        {
            Image = ContainerImage.FromEcrRepository(data.ApiRepository, imageTag),
            PortMappings = [new PortMapping { ContainerPort = 8080 }],
            Environment = new Dictionary<string, string>
            {
                // Production in dev too: the application's only environment switch is
                // IsDevelopment(), and everything behind it must be off in anything deployed. Never
                // an HTTPS port, never ASPNETCORE_FORWARDEDHEADERS_ENABLED (ADR 0044).
                ["ASPNETCORE_ENVIRONMENT"] = Production,
                ["ConnectionStrings__DefaultConnection"] = Connection.String(data, site),
                ["DataProtection__ParameterPath"] = site.DataProtectionPath,
                // The balancer's subnets are the trust list, and the limit stays 1 even behind
                // CloudFront, because the balancer preserves the header (ADR 0033, 0044).
                ["ForwardedHeaders__Enabled"] = "true",
                ["ForwardedHeaders__ForwardLimit"] = "1",
                ["ForwardedHeaders__KnownNetworks__0"] = albSubnets.Subnets[0].Ipv4CidrBlock,
                ["ForwardedHeaders__KnownNetworks__1"] = albSubnets.Subnets[1].Ipv4CidrBlock,
            },
            Secrets = new Dictionary<string, Amazon.CDK.AWS.ECS.Secret>
            {
                ["PGPASSWORD"] = Amazon.CDK.AWS.ECS.Secret.FromSecretsManager(data.DbSecret, "password"),
                ["Igdb__ClientId"] = Amazon.CDK.AWS.ECS.Secret.FromSecretsManager(data.IgdbSecret, "ClientId"),
                ["Igdb__ClientSecret"] = Amazon.CDK.AWS.ECS.Secret.FromSecretsManager(data.IgdbSecret, "ClientSecret"),
            },
            Logging = Logging(site, "api"),
        });

        return task;
    }

    private FargateTaskDefinition SsrTask(Site site, DataStack data, string imageTag)
    {
        var task = Task(site, "ssr");

        task.AddContainer("ssr", new ContainerDefinitionOptions
        {
            Image = ContainerImage.FromEcrRepository(data.SsrRepository, imageTag),
            PortMappings = [new PortMapping { ContainerPort = 3000 }],
            Environment = new Dictionary<string, string>
            {
                // Inside the VPC, by the name Cloud Map registers for the API service, plain HTTP.
                ["API_BASE_URL"] = $"http://api.{site.InternalDomain}:8080",
                ["SITE_URL"] = $"https://{site.Host}",
                ["PORT"] = "3000",
                // SITE_INDEXABLE stays unset: every response then says noindex (ADR 0036). HOST
                // stays unset so the server listens on every interface, which the balancer needs.
            },
            Logging = Logging(site, "ssr"),
        });

        return task;
    }

    private ApplicationTargetGroup TargetGroup(string id, DataStack data, int port, string healthPath) =>
        new(this, $"{id}TargetGroup", new ApplicationTargetGroupProps
        {
            Vpc = data.Vpc,
            Port = port,
            Protocol = ApplicationProtocol.HTTP,
            TargetType = TargetType.IP,
            DeregistrationDelay = Duration.Seconds(30),
            // Never /readyz: it makes a live IGDB call behind a thirty-second ceiling, and in an
            // IGDB outage the balancer would remove the very instance ADR 0034 says must stay in
            // rotation. /robots.txt is a resource route that calls nothing upstream.
            HealthCheck = new Amazon.CDK.AWS.ElasticLoadBalancingV2.HealthCheck { Path = healthPath },
        });

    private FargateTaskDefinition Task(Site site, string name) =>
        // The smallest Fargate size; neither process has been measured (ADR 0044).
        new(this, $"{name}Task", new FargateTaskDefinitionProps
        {
            Family = $"{site.Prefix}-{name}",
            Cpu = 256,
            MemoryLimitMiB = 512,
        });

    private LogDriver Logging(Site site, string name) =>
        LogDrivers.AwsLogs(new AwsLogDriverProps
        {
            LogGroup = new LogGroup(this, $"{name}Logs", new LogGroupProps
            {
                LogGroupName = site.LogGroup(name),
                Retention = RetentionDays.TWO_WEEKS,
                RemovalPolicy = RemovalPolicy.DESTROY,
            }),
            StreamPrefix = name,
        });

    private FargateService Service(Site site, DataStack data, string name, FargateTaskDefinition task,
        ISecurityGroup securityGroup, SubnetSelection subnets, bool registerInNamespace) =>
        new(this, $"{name}Service", new FargateServiceProps
        {
            ServiceName = name,
            Cluster = data.Cluster,
            TaskDefinition = task,
            // One task per service is what makes AddMemoryCache correct: the IGDB token, the caches
            // and both limiters are per process (ADR 0033, 0034). Not raised before #101.
            DesiredCount = 1,
            AssignPublicIp = true,
            VpcSubnets = subnets,
            SecurityGroups = [securityGroup],
            HealthCheckGracePeriod = Duration.Seconds(60),
            // A deploy starts the new task before stopping the old one, and a revision whose tasks
            // never pass their health checks is rolled back rather than retried.
            MinHealthyPercent = 100,
            MaxHealthyPercent = 200,
            CircuitBreaker = new DeploymentCircuitBreaker { Enable = true, Rollback = true },
            // Cloud Map DNS rather than Service Connect: a name and nothing else, no sidecar, and the
            // API sees the SSR task's own address rather than loopback (ADR 0044).
            CloudMapOptions = registerInNamespace
                ? new CloudMapOptions
                {
                    Name = name,
                    CloudMapNamespace = data.Cluster.DefaultCloudMapNamespace,
                    DnsRecordType = DnsRecordType.A,
                    DnsTtl = Duration.Seconds(10),
                }
                : null,
        });
}
