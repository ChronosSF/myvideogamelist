using Amazon.CDK;
using Amazon.CDK.AWS.CertificateManager;
using Amazon.CDK.AWS.CloudFront;
using Amazon.CDK.AWS.EC2;
using Amazon.CDK.AWS.ECR;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.Route53;
using Amazon.CDK.AWS.SecretsManager;
using Amazon.CDK.AWS.ServiceDiscovery;
using Constructs;

namespace Infra;

/// <summary>
/// Everything long-lived: the network and every security group, the database and its secret, the
/// image repositories, the cluster and its private namespace, the regional certificate, the deploy
/// role GitHub assumes, and the store the basic-auth credential lives in. The application stack can
/// be destroyed and recreated without touching any of it, which is the pause lever that matters
/// (ADR 0044).
/// </summary>
public sealed class DataStack : Stack
{
    public Vpc Vpc { get; }
    public SecurityGroup AlbSecurityGroup { get; }
    public SecurityGroup ApiSecurityGroup { get; }
    public SecurityGroup SsrSecurityGroup { get; }
    public DatabaseInstance Database { get; }
    public DatabaseSecret DbSecret { get; }
    public Secret IgdbSecret { get; }
    public Repository ApiRepository { get; }
    public Repository SsrRepository { get; }
    public Amazon.CDK.AWS.ECS.Cluster Cluster { get; }
    public ICertificate Certificate { get; }
    public KeyValueStore BasicAuthStore { get; }

    public DataStack(Construct scope, string id, IStackProps props, Site site, IHostedZone zone, string? allowedCidr)
        : base(scope, id, props)
    {
        // Two availability zones because a balancer and an RDS subnet group each need two; no NAT
        // gateway (ADR 0015) - the tasks have public addresses and reach IGDB, Steam, ECR and the
        // AWS APIs through the internet gateway. The balancer gets subnets of its own so that "the
        // balancer's subnets" is an exact thing to name in the forwarded-headers trust list.
        Vpc = new Vpc(this, "Vpc", new VpcProps
        {
            VpcName = site.Prefix,
            MaxAzs = 2,
            NatGateways = 0,
            SubnetConfiguration =
            [
                new SubnetConfiguration { Name = "alb", SubnetType = SubnetType.PUBLIC, CidrMask = 27 },
                new SubnetConfiguration { Name = "tasks", SubnetType = SubnetType.PUBLIC, CidrMask = 24 },
                new SubnetConfiguration { Name = "data", SubnetType = SubnetType.PRIVATE_ISOLATED, CidrMask = 24 },
            ],
        });

        // All four groups and every rule between them live here, so the application stack can come
        // and go without touching them and the two stacks cannot form a dependency cycle.
        AlbSecurityGroup = Group("Alb", "the load balancer", allowAllOutbound: true);
        ApiSecurityGroup = Group("Api", "the API tasks", allowAllOutbound: true);
        SsrSecurityGroup = Group("Ssr", "the SSR tasks", allowAllOutbound: true);
        var dbSecurityGroup = Group("Db", "the database", allowAllOutbound: false);

        if (allowedCidr is not null)
        {
            // Before CloudFront exists, dev is kept private by admitting one address: the owner's.
            AlbSecurityGroup.AddIngressRule(Peer.Ipv4(allowedCidr), Port.Tcp(443), "HTTPS from the allowed address");
            AlbSecurityGroup.AddIngressRule(Peer.Ipv4(allowedCidr), Port.Tcp(80), "HTTP from the allowed address, to be redirected");
        }
        else
        {
            // With the parameter absent, only CloudFront's origin-facing addresses may reach the
            // balancer, so forgetting it fails closed: unreachable rather than public. The managed
            // list counts as 55 rules against a default quota of 60 per group, so it fits on one
            // port, and the port-80 listener is not reachable from anywhere once this applies.
            var cloudFront = PrefixList.FromLookup(this, "CloudFrontOrigins", new PrefixListLookupOptions
            {
                PrefixListName = "com.amazonaws.global.cloudfront.origin-facing",
            });
            AlbSecurityGroup.AddIngressRule(Peer.PrefixList(cloudFront.PrefixListId), Port.Tcp(443), "HTTPS from CloudFront only");
        }

        ApiSecurityGroup.AddIngressRule(AlbSecurityGroup, Port.Tcp(8080), "from the balancer");
        ApiSecurityGroup.AddIngressRule(SsrSecurityGroup, Port.Tcp(8080), "from the SSR server");
        SsrSecurityGroup.AddIngressRule(AlbSecurityGroup, Port.Tcp(3000), "from the balancer");
        dbSecurityGroup.AddIngressRule(ApiSecurityGroup, Port.Tcp(5432), "from the API tasks");

        // A generated secret of our own rather than RDS's managed master password: that one rotates
        // on a schedule, ECS reads secrets only when a task starts, and a running task would be left
        // holding a password that no longer works.
        DbSecret = new DatabaseSecret(this, "DbSecret", new DatabaseSecretProps
        {
            SecretName = site.DbSecretName,
            Username = "mvgl",
        });

        Database = new DatabaseInstance(this, "Database", new DatabaseInstanceProps
        {
            Engine = DatabaseInstanceEngine.Postgres(new PostgresInstanceEngineProps { Version = PostgresEngineVersion.VER_18 }),
            InstanceType = Amazon.CDK.AWS.EC2.InstanceType.Of(InstanceClass.BURSTABLE4_GRAVITON, InstanceSize.MICRO),
            InstanceIdentifier = $"{site.Prefix}-db",
            DatabaseName = "myvideogamelist",
            Credentials = Credentials.FromSecret(DbSecret),
            Vpc = Vpc,
            VpcSubnets = new SubnetSelection { SubnetGroupName = "data" },
            SecurityGroups = [dbSecurityGroup],
            PubliclyAccessible = false,
            MultiAz = false,
            AllocatedStorage = 20,
            StorageType = StorageType.GP3,
            StorageEncrypted = true,
            BackupRetention = Duration.Days(7),
            DeletionProtection = true,
            EnablePerformanceInsights = false,
            RemovalPolicy = RemovalPolicy.SNAPSHOT,
        });

        // Created with a placeholder so the real value never passes through CloudFormation or the
        // repository; it is set by hand once the stack exists (ADR 0005).
        IgdbSecret = new Secret(this, "IgdbSecret", new SecretProps
        {
            SecretName = site.IgdbSecretName,
            Description = "IGDB client credentials. Set the real ClientId and ClientSecret by hand.",
            GenerateSecretString = new SecretStringGenerator
            {
                SecretStringTemplate = "{\"ClientId\":\"set-me\"}",
                GenerateStringKey = "ClientSecret",
            },
        });

        ApiRepository = ImageRepository("Api", "mvgl/api");
        SsrRepository = ImageRepository("Ssr", "mvgl/ssr");

        // The cluster costs nothing. Its namespace is a Route 53 private zone, billed on creation
        // unless deleted within twelve hours, which is why it lives here and not with the services.
        Cluster = new Amazon.CDK.AWS.ECS.Cluster(this, "Cluster", new Amazon.CDK.AWS.ECS.ClusterProps
        {
            ClusterName = site.Prefix,
            Vpc = Vpc,
            EnableFargateCapacityProviders = true,
            DefaultCloudMapNamespace = new Amazon.CDK.AWS.ECS.CloudMapNamespaceOptions
            {
                Name = site.InternalDomain,
                Type = NamespaceType.DNS_PRIVATE,
                UseForServiceConnect = false,
            },
        });

        Certificate = new Certificate(this, "Certificate", new CertificateProps
        {
            DomainName = site.Host,
            Validation = CertificateValidation.FromDns(zone),
        });

        // The basic-auth credential for the CloudFront function, kept here so it survives a destroy
        // of the application stack. The value is set by hand, never in the repository.
        BasicAuthStore = new KeyValueStore(this, "BasicAuth", new KeyValueStoreProps
        {
            KeyValueStoreName = $"{site.Prefix}-basic-auth",
            Comment = "basic-auth: the expected Authorization header value for the dev site",
        });

        var deployRole = DeployRole(site);

        var taskSubnets = Vpc.SelectSubnets(new SubnetSelection { SubnetGroupName = "tasks" });
        _ = new CfnOutput(this, "TaskSubnetIds", new CfnOutputProps { Value = Fn.Join(",", taskSubnets.SubnetIds) });
        _ = new CfnOutput(this, "ApiSecurityGroupId", new CfnOutputProps { Value = ApiSecurityGroup.SecurityGroupId });
        _ = new CfnOutput(this, "ApiRepositoryUri", new CfnOutputProps { Value = ApiRepository.RepositoryUri });
        _ = new CfnOutput(this, "SsrRepositoryUri", new CfnOutputProps { Value = SsrRepository.RepositoryUri });
        _ = new CfnOutput(this, "DatabaseEndpoint", new CfnOutputProps { Value = Database.InstanceEndpoint.Hostname });
        _ = new CfnOutput(this, "BasicAuthStoreArn", new CfnOutputProps { Value = BasicAuthStore.KeyValueStoreArn });
        _ = new CfnOutput(this, "DeployRoleArn", new CfnOutputProps { Value = deployRole.RoleArn });
    }

    private SecurityGroup Group(string id, string description, bool allowAllOutbound) =>
        new(this, $"{id}SecurityGroup", new SecurityGroupProps
        {
            Vpc = Vpc,
            Description = $"MVGL: {description}",
            AllowAllOutbound = allowAllOutbound,
        });

    private Repository ImageRepository(string id, string name) =>
        new(this, $"{id}Repository", new RepositoryProps
        {
            RepositoryName = name,
            // Images are SHA-tagged and never overwritten (ADR 0007).
            ImageTagMutability = TagMutability.IMMUTABLE,
            LifecycleRules = [new LifecycleRule { MaxImageCount = 20, Description = "keep the most recent 20 images" }],
            RemovalPolicy = RemovalPolicy.RETAIN,
        });

    /// <summary>
    /// The role GitHub Actions assumes through OIDC, so no AWS key is ever stored in GitHub. It can
    /// push the two images, run the migration task, read service health and assume the CDK bootstrap
    /// roles - and little else. Everything it deploys, it deploys as those roles (ADR 0044).
    /// </summary>
    private Role DeployRole(Site site)
    {
        // An account holds one provider per URL; a fresh account has none.
        var gitHub = new OpenIdConnectProvider(this, "GitHub", new OpenIdConnectProviderProps
        {
            Url = "https://token.actions.githubusercontent.com",
            ClientIds = ["sts.amazonaws.com"],
        });

        var role = new Role(this, "DeployRole", new RoleProps
        {
            RoleName = $"{site.Prefix}-github-deploy",
            Description = "Assumed by GitHub Actions deploy jobs through OIDC",
            MaxSessionDuration = Duration.Hours(1),
            AssumedBy = new WebIdentityPrincipal(gitHub.OpenIdConnectProviderArn, new Dictionary<string, object>
            {
                ["StringEquals"] = new Dictionary<string, object>
                {
                    ["token.actions.githubusercontent.com:aud"] = "sts.amazonaws.com",
                    ["token.actions.githubusercontent.com:sub"] = site.GitHubSubject,
                },
            }),
        });

        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "AssumeCdkBootstrapRoles",
            Actions = ["sts:AssumeRole"],
            Resources = [$"arn:{Aws.PARTITION}:iam::{Account}:role/cdk-hnb659fds-*"],
        }));
        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "EcrLogin",
            Actions = ["ecr:GetAuthorizationToken"],
            Resources = ["*"],
        }));
        ApiRepository.GrantPullPush(role);
        SsrRepository.GrantPullPush(role);
        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "RunTheMigrationTask",
            Actions = ["ecs:RunTask"],
            Resources = [$"arn:{Aws.PARTITION}:ecs:{Region}:{Account}:task-definition/{site.Prefix}-migrate:*"],
        }));
        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "PassTheMigrationTaskRoles",
            Actions = ["iam:PassRole"],
            Resources =
            [
                $"arn:{Aws.PARTITION}:iam::{Account}:role/{site.Prefix}-migrate-task",
                $"arn:{Aws.PARTITION}:iam::{Account}:role/{site.Prefix}-migrate-execution",
            ],
        }));
        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "ReadHealth",
            Actions = ["ecs:DescribeTasks", "ecs:DescribeServices", "elasticloadbalancing:DescribeTargetHealth"],
            Resources = ["*"],
        }));
        // The workflow reads the task subnets, the API security group and the target groups from
        // stack outputs rather than carrying copies of them, and prints the migration bundle's
        // log so a failed release says why. Reads only, on this environment's stacks and that one
        // log group.
        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "ReadStackOutputs",
            Actions = ["cloudformation:DescribeStacks"],
            // The two stacks it reads, by name - not every stack of this environment's.
            Resources =
            [
                $"arn:{Aws.PARTITION}:cloudformation:{Region}:{Account}:stack/{site.StackName("Data")}/*",
                $"arn:{Aws.PARTITION}:cloudformation:{Region}:{Account}:stack/{site.StackName("App")}/*",
            ],
        }));
        role.AddToPolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "ReadTheMigrationLog",
            Actions = ["logs:FilterLogEvents", "logs:GetLogEvents", "logs:DescribeLogStreams"],
            Resources = [$"arn:{Aws.PARTITION}:logs:{Region}:{Account}:log-group:{site.LogGroup("migrate")}:*"],
        }));

        return role;
    }
}
