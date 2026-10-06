using Amazon.CDK;
using Amazon.CDK.AWS.ECS;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Logs;
using Constructs;

namespace Infra;

/// <summary>
/// One task definition that runs the migration bundle baked into the API image, deployed and run
/// before the application stack changes so that old and new revisions never race each other
/// through the same migration (ADR 0007, 0044). It is run, not scheduled: the pipeline calls
/// <c>ecs run-task</c> with the task subnets and the API security group from the data stack's
/// outputs, and fails the release on a non-zero exit code.
/// </summary>
public sealed class MigrateStack : Stack
{
    public FargateTaskDefinition TaskDefinition { get; }

    public MigrateStack(Construct scope, string id, IStackProps props, Site site, DataStack data, string imageTag)
        : base(scope, id, props)
    {
        // Named, because the deploy role in the data stack has to be allowed to pass exactly these
        // two roles without depending on this stack, which is redeployed every release.
        var taskRole = new Role(this, "TaskRole", new RoleProps
        {
            RoleName = $"{site.Prefix}-migrate-task",
            AssumedBy = new ServicePrincipal("ecs-tasks.amazonaws.com"),
        });
        var executionRole = new Role(this, "ExecutionRole", new RoleProps
        {
            RoleName = $"{site.Prefix}-migrate-execution",
            AssumedBy = new ServicePrincipal("ecs-tasks.amazonaws.com"),
        });

        TaskDefinition = new FargateTaskDefinition(this, "Task", new FargateTaskDefinitionProps
        {
            Family = $"{site.Prefix}-migrate",
            Cpu = 256,
            MemoryLimitMiB = 512,
            TaskRole = taskRole,
            ExecutionRole = executionRole,
        });

        var logs = new LogGroup(this, "Logs", new LogGroupProps
        {
            LogGroupName = site.LogGroup("migrate"),
            Retention = RetentionDays.TWO_WEEKS,
            RemovalPolicy = RemovalPolicy.DESTROY,
        });

        TaskDefinition.AddContainer("migrate", new ContainerDefinitionOptions
        {
            Image = ContainerImage.FromEcrRepository(data.ApiRepository, imageTag),
            // The API image, with its entry point overridden to the bundle. It runs from /app so
            // that EF finds appsettings.json beside it.
            EntryPoint = ["/app/efbundle"],
            WorkingDirectory = "/app",
            Environment = new Dictionary<string, string>
            {
                ["ASPNETCORE_ENVIRONMENT"] = "Production",
                ["ConnectionStrings__DefaultConnection"] = Connection.String(data, site),
                // The bundle builds the application's host before migrating, and as Production the
                // host refuses to start without a key store (ADR 0043). Naming the path satisfies
                // that; nothing is protected during a migration, so Parameter Store is never read
                // and this role needs no permission on it.
                ["DataProtection__ParameterPath"] = site.DataProtectionPath,
            },
            Secrets = new Dictionary<string, Amazon.CDK.AWS.ECS.Secret>
            {
                ["PGPASSWORD"] = Amazon.CDK.AWS.ECS.Secret.FromSecretsManager(data.DbSecret, "password"),
            },
            Logging = LogDrivers.AwsLogs(new AwsLogDriverProps { LogGroup = logs, StreamPrefix = "migrate" }),
        });

        _ = new CfnOutput(this, "TaskDefinitionArn", new CfnOutputProps { Value = TaskDefinition.TaskDefinitionArn });
    }
}
