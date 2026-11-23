using System.Globalization;
using Amazon.CDK;
using Amazon.CDK.AWS.ECS;
using Amazon.CDK.AWS.IAM;
using Amazon.CDK.AWS.Logs;
using Amazon.CDK.AWS.RDS;
using Amazon.CDK.AWS.S3;
using Constructs;
using ISecret = Amazon.CDK.AWS.SecretsManager.ISecret;

namespace Infra;

/// <summary>
/// The names the two halves of a move of the database agree on (ADR 0109), derived from the two
/// environments it runs between. The launch's is dev's database into production's, through a bucket in
/// production's account. The rehearsal's is the same steps inside dev's account, into a stand-in made for
/// the purpose. <c>scripts/move-data.mjs</c> restates only the stack names, and reads the rest from the
/// stacks' outputs.
/// </summary>
public sealed record Move(Site Source, Site Target, bool IsRehearsal)
{
    /// <summary>Dev's accounts and lists, into production, at launch (#465).</summary>
    public static Move Launch => new(new Site("dev"), new Site(Site.Production), IsRehearsal: false);

    /// <summary>The launch's steps inside dev's account, into a stand-in for production's database.</summary>
    public static Move Rehearsal => new(new Site("dev"), new Site("dev"), IsRehearsal: true);

    /// <summary>The one object the bucket ever holds: the dump, in pg_dump's custom format.</summary>
    public const string Key = "myvideogamelist.dump";

    private string Prefix(Site site) => IsRehearsal ? $"{site.Prefix}-move-rehearsal" : $"{site.Prefix}-move";

    /// <summary>The dump task's family and its role's name, in the source's account: <c>mvgl-dev-move-dump</c>.</summary>
    public string DumpName => $"{Prefix(Source)}-dump";

    /// <summary>The restore task's family and its role's name, in the target's account: <c>mvgl-prod-move-restore</c>.</summary>
    public string RestoreName => $"{Prefix(Target)}-restore";

    /// <summary>
    /// In the target's account, and named with it: a bucket's name is global, and the source's half has
    /// to name the bucket before either exists.
    /// </summary>
    public string BucketName => $"{Prefix(Target)}-{Target.Account}";

    /// <summary>By name rather than by reference: the role is in the other account, or in the same stack.</summary>
    public string DumpRoleArn => $"arn:{Aws.PARTITION}:iam::{Source.Account}:role/{DumpName}";

    public string RestoreRoleArn => $"arn:{Aws.PARTITION}:iam::{Target.Account}:role/{RestoreName}";

    public string DumpLogGroup => Source.LogGroup(IsRehearsal ? "move-rehearsal" : "move");

    public string RestoreLogGroup => Target.LogGroup(IsRehearsal ? "move-rehearsal" : "move");

    /// <summary>The rehearsal's stand-in for production's database.</summary>
    public string StandInIdentifier => $"{Prefix(Target)}-db";
}

/// <summary>
/// What both halves' tasks are made of. Each task is two containers sharing a directory on the task's own
/// storage: PostgreSQL's image, for pg_dump, pg_restore and psql of the server's major version, and AWS's
/// CLI, for the bucket. The second waits for the first to stop, and does nothing unless the first left its
/// mark, so the task's exit code is the essential container's and says whether the whole of it worked.
/// </summary>
internal static class MoveTasks
{
    /// <summary>The image compose.yaml runs locally and the restore drill read with (ADR 0107).</summary>
    private const string PostgresImage = "public.ecr.aws/docker/library/postgres:18-alpine";

    /// <summary>Pinned, as nothing else here is: it is the one thing that holds a credential for the bucket.</summary>
    private const string AwsCliImage = "public.ecr.aws/aws-cli/aws-cli:2.39.1";

    private const string Volume = "move";

    /// <summary>
    /// What the move compares, read the same way from the source before and after the dump and from the
    /// copy after the restore: the server's version, the migrations, every table's row count and every
    /// sequence's last value. Names and numbers, nothing of anybody's. The restore drill's query (ADR 0107),
    /// with the migrations' count and the sequences added.
    /// </summary>
    private const string CheckSql =
        """
        select line from (
          select 1 as o, 'server ' || current_setting('server_version') as line
          union all
          select 2, 'migrations ' || (select count(*) from "__EFMigrationsHistory") || ' latest ' || (select max("MigrationId") from "__EFMigrationsHistory")
          union all
          select 3, 'table ' || c.relname || ' ' || (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', ns.nspname, c.relname), false, true, '')))[1]::text
          from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
          where c.relkind = 'r' and ns.nspname = 'public'
          union all
          select 4, 'sequence ' || s.sequencename || ' ' || coalesce(s.last_value::text, 'unread')
          from pg_sequences s where s.schemaname = 'public'
        ) t order by o, line;
        """;

    /// <summary>Every relation outside PostgreSQL's own schemas: a database that holds any is not one the restore writes into.</summary>
    private const string EmptySql =
        """
        select count(*) from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname <> 'information_schema' and ns.nspname !~ '^pg_';
        """;

    /// <summary>
    /// The source, in a session that cannot write: counted, dumped, counted again. The dump waits at most
    /// five seconds for any table's lock, as the migration task does (ADR 0079), so it never queues behind a
    /// release's DDL; a dump that cannot start is run again.
    /// </summary>
    internal const string DumpScript =
        """
        set -euo pipefail
        pg_dump --version
        check() { psql -X -At -v ON_ERROR_STOP=1 -c "$CHECK_SQL" | sed "s/^/$1 /"; }
        check before
        started=$(date +%s)
        pg_dump --format=custom --no-owner --no-privileges --lock-wait-timeout=5s --file=/move/myvideogamelist.dump
        size=$(wc -c < /move/myvideogamelist.dump)
        sum=$(sha256sum /move/myvideogamelist.dump | cut -d ' ' -f 1)
        echo "dumped $size bytes in $(( $(date +%s) - started ))s, sha256 $sum"
        check after
        touch /move/dumped
        echo "dump: done"
        """;

    internal const string UploadScript =
        """
        set -euo pipefail
        trap 'rm -f /move/myvideogamelist.dump' EXIT
        if [ ! -f /move/dumped ]; then echo "The dump did not finish, so nothing was uploaded."; exit 1; fi
        aws --version
        started=$(date +%s)
        aws s3 cp /move/myvideogamelist.dump "s3://$BUCKET/$KEY" --expected-bucket-owner "$BUCKET_OWNER" --only-show-errors
        echo "uploaded to s3://$BUCKET/$KEY in $(( $(date +%s) - started ))s"
        echo "upload: done"
        """;

    internal const string DownloadScript =
        """
        set -euo pipefail
        started=$(date +%s)
        aws s3 cp "s3://$BUCKET/$KEY" /move/myvideogamelist.dump --expected-bucket-owner "$BUCKET_OWNER" --only-show-errors
        size=$(wc -c < /move/myvideogamelist.dump)
        sum=$(sha256sum /move/myvideogamelist.dump | cut -d ' ' -f 1)
        echo "downloaded $size bytes in $(( $(date +%s) - started ))s, sha256 $sum"
        touch /move/downloaded
        echo "download: done"
        """;

    /// <summary>
    /// Into an empty database only, which is what makes the restore safe to run again and impossible to run
    /// over a database in service: exit 3 says it refused. In one transaction, so a restore that fails leaves
    /// the database as empty as it found it. Its statistics are gathered at once, and the copy is counted in
    /// a session that cannot write.
    /// </summary>
    internal const string RestoreScript =
        """
        set -euo pipefail
        trap 'rm -f /move/myvideogamelist.dump' EXIT
        if [ ! -f /move/downloaded ]; then echo "The download did not finish, so nothing was restored."; exit 1; fi
        pg_restore --version
        held=$(psql -X -At -v ON_ERROR_STOP=1 -c "$EMPTY_SQL")
        if [ "$held" != "0" ]; then
          echo "Refused: $PGDATABASE on $PGHOST already holds $held relations, and the restore writes only into an empty database."
          exit 3
        fi
        started=$(date +%s)
        pg_restore --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$PGDATABASE" /move/myvideogamelist.dump
        echo "restored in $(( $(date +%s) - started ))s"
        psql -X -q -v ON_ERROR_STOP=1 -c "ANALYZE"
        PGOPTIONS="-c default_transaction_read_only=on" psql -X -At -v ON_ERROR_STOP=1 -c "$CHECK_SQL" | sed "s/^/copy /"
        echo "restore: done"
        """;

    internal static LogGroup Logs(Construct scope, string name) =>
        new(scope, "Logs", new LogGroupProps
        {
            LogGroupName = name,
            // Table names, counts and timings, and nothing of anybody's. They go with the stack.
            Retention = RetentionDays.ONE_WEEK,
            RemovalPolicy = RemovalPolicy.DESTROY,
        });

    internal static Role TaskRole(Construct scope, string name, string description, PolicyStatement statement)
    {
        var role = new Role(scope, "TaskRole", new RoleProps
        {
            RoleName = name,
            Description = description,
            AssumedBy = new ServicePrincipal("ecs-tasks.amazonaws.com"),
            MaxSessionDuration = Duration.Hours(1),
        });
        role.AddToPolicy(statement);
        return role;
    }

    internal static FargateTaskDefinition Definition(Construct scope, string family, IRole taskRole)
    {
        var task = new FargateTaskDefinition(scope, "Task", new FargateTaskDefinitionProps
        {
            Family = family,
            Cpu = 256,
            MemoryLimitMiB = 1024,
            TaskRole = taskRole,
        });
        // The task's own storage, which the two containers share: the dump lies here between them, and
        // the last container deletes it as it exits.
        task.AddVolume(new Amazon.CDK.AWS.ECS.Volume { Name = Volume });
        return task;
    }

    /// <summary>
    /// psql, pg_dump and pg_restore, connected as the API is: over TLS, as its user, with the password from
    /// the database's secret. A session that only reads is told so, and then cannot write.
    /// </summary>
    internal static ContainerDefinition Postgres(FargateTaskDefinition task, string name, string script, string host,
        ISecret password, ILogGroup logs, bool readOnly, bool essential)
    {
        var environment = new Dictionary<string, string>
        {
            ["PGHOST"] = host,
            ["PGPORT"] = "5432",
            ["PGUSER"] = DataStack.DatabaseUser,
            ["PGDATABASE"] = DataStack.DatabaseName,
            ["PGSSLMODE"] = "require",
            ["PGCONNECT_TIMEOUT"] = "15",
            // What pg_stat_activity names the session, so that it is plain on the live database.
            ["PGAPPNAME"] = $"mvgl-move-{name}",
            ["CHECK_SQL"] = CheckSql,
            ["EMPTY_SQL"] = EmptySql,
        };
        if (readOnly)
        {
            environment["PGOPTIONS"] = "-c default_transaction_read_only=on";
        }

        var container = task.AddContainer(name, new ContainerDefinitionOptions
        {
            Image = ContainerImage.FromRegistry(PostgresImage),
            Essential = essential,
            EntryPoint = ["sh", "-c"],
            Command = [script],
            Environment = environment,
            Secrets = new Dictionary<string, Amazon.CDK.AWS.ECS.Secret>
            {
                ["PGPASSWORD"] = Amazon.CDK.AWS.ECS.Secret.FromSecretsManager(password, "password"),
            },
            Logging = LogDrivers.AwsLogs(new AwsLogDriverProps { LogGroup = logs, StreamPrefix = "move" }),
        });
        container.AddMountPoints(new MountPoint { ContainerPath = "/move", SourceVolume = Volume, ReadOnly = false });
        return container;
    }

    /// <summary>The CLI, given the bucket, the key and the account that has to own the bucket.</summary>
    internal static ContainerDefinition AwsCli(FargateTaskDefinition task, string name, string script, Move move,
        ILogGroup logs, bool essential)
    {
        var container = task.AddContainer(name, new ContainerDefinitionOptions
        {
            Image = ContainerImage.FromRegistry(AwsCliImage),
            Essential = essential,
            EntryPoint = ["sh", "-c"],
            Command = [script],
            Environment = new Dictionary<string, string>
            {
                ["BUCKET"] = move.BucketName,
                ["KEY"] = Move.Key,
                // A bucket of that name in any other account is refused rather than written to.
                ["BUCKET_OWNER"] = move.Target.Account,
            },
            Logging = LogDrivers.AwsLogs(new AwsLogDriverProps { LogGroup = logs, StreamPrefix = "move" }),
        });
        container.AddMountPoints(new MountPoint { ContainerPath = "/move", SourceVolume = Volume, ReadOnly = false });
        return container;
    }

    /// <summary>The second container starts once the first has stopped, however it stopped.</summary>
    internal static void After(ContainerDefinition second, ContainerDefinition first) =>
        second.AddContainerDependencies(new ContainerDependency
        {
            Container = first,
            Condition = ContainerDependencyCondition.COMPLETE,
        });

    internal static void Output(Stack stack, string key, string value) =>
        _ = new CfnOutput(stack, key, new CfnOutputProps { Value = value });
}

/// <summary>
/// The source's half: one task that counts the source database, dumps it in a session that cannot write,
/// counts it again, and puts the dump in the target's bucket. Its role may write that one object and do
/// nothing else, and the bucket's policy admits that role by name and no other writer.
/// </summary>
internal sealed class MoveOut : Construct
{
    public FargateTaskDefinition Task { get; }

    public MoveOut(Construct scope, string id, Move move, string host, ISecret password, ILogGroup logs)
        : base(scope, id)
    {
        var role = MoveTasks.TaskRole(this, move.DumpName,
            $"Dumps the {move.Source.Env} database into {move.BucketName} (ADR 0109)",
            new PolicyStatement(new PolicyStatementProps
            {
                Sid = "WriteTheDump",
                Actions = ["s3:PutObject", "s3:AbortMultipartUpload"],
                Resources = [$"arn:{Aws.PARTITION}:s3:::{move.BucketName}/{Move.Key}"],
            }));

        Task = MoveTasks.Definition(this, move.DumpName, role);
        var dump = MoveTasks.Postgres(Task, "dump", MoveTasks.DumpScript, host, password, logs, readOnly: true, essential: false);
        var upload = MoveTasks.AwsCli(Task, "upload", MoveTasks.UploadScript, move, logs, essential: true);
        MoveTasks.After(upload, dump);
    }
}

/// <summary>
/// The target's half: the bucket the dump crosses in, and one task that fetches it and restores it into the
/// target database, which has to be empty. The bucket is private, encrypted at rest by S3, reached only
/// over TLS, owns whatever is written to it, admits one writer and one reader by their roles' names, and
/// expires what it holds after a day if nobody deletes it first.
/// </summary>
internal sealed class MoveIn : Construct
{
    public Bucket Bucket { get; }

    public FargateTaskDefinition Task { get; }

    public MoveIn(Construct scope, string id, Move move, string host, ISecret password, ILogGroup logs)
        : base(scope, id)
    {
        Bucket = new Bucket(this, "Bucket", new BucketProps
        {
            BucketName = move.BucketName,
            BlockPublicAccess = BlockPublicAccess.BLOCK_ALL,
            Encryption = BucketEncryption.S3_MANAGED,
            EnforceSSL = true,
            // The bucket's account owns every object in it, the one the other account writes included, so
            // the reader in this account can read it.
            ObjectOwnership = ObjectOwnership.BUCKET_OWNER_ENFORCED,
            // A delete is the end of the object, with no older version kept behind it.
            Versioned = false,
            // The backstop, never the plan: the move deletes the dump the moment the restore has read it.
            LifecycleRules =
            [
                new LifecycleRule
                {
                    Id = "the-dump-lasts-a-day",
                    Expiration = Duration.Days(1),
                    AbortIncompleteMultipartUploadAfter = Duration.Days(1),
                },
            ],
            // A bucket that still holds anything is not deleted, so a destroy that succeeds says it was empty.
            RemovalPolicy = RemovalPolicy.DESTROY,
        });

        var dump = Bucket.ArnForObjects(Move.Key);
        // The writer is named by its account and, on a condition, by its role's ARN: a role as the principal
        // is saved as the role's unique id, and that role is made in another stack, as EmailStack explains.
        Bucket.AddToResourcePolicy(new PolicyStatement(new PolicyStatementProps
        {
            Sid = "TheDumpTaskWrites",
            Principals = [new AccountPrincipal(move.Source.Account)],
            Actions = ["s3:PutObject", "s3:AbortMultipartUpload"],
            Resources = [dump],
            Conditions = new Dictionary<string, object>
            {
                ["ArnEquals"] = new Dictionary<string, object> { ["aws:PrincipalArn"] = move.DumpRoleArn },
            },
        }));
        Bucket.AddToResourcePolicy(OnlyBy("NobodyElseReads", "s3:GetObject", move.RestoreRoleArn, Bucket.ArnForObjects("*")));
        Bucket.AddToResourcePolicy(OnlyBy("NobodyElseWrites", "s3:PutObject", move.DumpRoleArn, Bucket.ArnForObjects("*")));

        var role = MoveTasks.TaskRole(this, move.RestoreName,
            $"Restores the dump in {move.BucketName} into the {move.Target.Env} database (ADR 0109)",
            new PolicyStatement(new PolicyStatementProps
            {
                Sid = "ReadTheDump",
                Actions = ["s3:GetObject"],
                Resources = [dump],
            }));

        Task = MoveTasks.Definition(this, move.RestoreName, role);
        var download = MoveTasks.AwsCli(Task, "download", MoveTasks.DownloadScript, move, logs, essential: false);
        var restore = MoveTasks.Postgres(Task, "restore", MoveTasks.RestoreScript, host, password, logs, readOnly: false, essential: true);
        MoveTasks.After(restore, download);
    }

    /// <summary>Denies an action to every principal but one, whatever any other policy allows it.</summary>
    private static PolicyStatement OnlyBy(string sid, string action, string roleArn, string resource) =>
        new(new PolicyStatementProps
        {
            Sid = sid,
            Effect = Effect.DENY,
            Principals = [new AnyPrincipal()],
            Actions = [action],
            Resources = [resource],
            Conditions = new Dictionary<string, object>
            {
                ["ArnNotEquals"] = new Dictionary<string, object> { ["aws:PrincipalArn"] = roleArn },
            },
        });
}

/// <summary>
/// Dev's half of the launch's move: the dump task, allowed to write one object into production's bucket.
/// Deployed by hand before the day, destroyed after it (ADR 0109).
/// </summary>
public sealed class MoveOutStack : Stack
{
    public MoveOutStack(Construct scope, string id, IStackProps props, Move move, DataStack data)
        : base(scope, id, props)
    {
        var logs = MoveTasks.Logs(this, move.DumpLogGroup);
        var half = new MoveOut(this, "Out", move, data.Database.InstanceEndpoint.Hostname, data.DbSecret, logs);

        MoveTasks.Output(this, "DumpTaskFamily", half.Task.Family);
        MoveTasks.Output(this, "DumpLogGroup", logs.LogGroupName);
        MoveTasks.Output(this, "BucketName", move.BucketName);
    }
}

/// <summary>
/// Production's half of the launch's move: the bucket, and the restore task into production's database.
/// Deployed by hand before the day, destroyed after it (ADR 0109).
/// </summary>
public sealed class MoveInStack : Stack
{
    public MoveInStack(Construct scope, string id, IStackProps props, Move move, DataStack data)
        : base(scope, id, props)
    {
        var logs = MoveTasks.Logs(this, move.RestoreLogGroup);
        var half = new MoveIn(this, "In", move, data.Database.InstanceEndpoint.Hostname, data.DbSecret, logs);

        MoveTasks.Output(this, "RestoreTaskFamily", half.Task.Family);
        MoveTasks.Output(this, "RestoreLogGroup", logs.LogGroupName);
        MoveTasks.Output(this, "BucketName", half.Bucket.BucketName);
    }
}

/// <summary>
/// Both halves inside dev's account, and a stand-in for production's database for the restore to write
/// into: what <c>scripts/move-data.mjs rehearse</c> deploys, runs and destroys the same hour (ADR 0109).
/// </summary>
/// <remarks>
/// The stand-in is made as the Data stack makes a database, in the shape production's will be on the day:
/// the same engine version, class, storage and encryption, the same database and user, in the live
/// database's isolated subnets behind its security group, which admits the API's tasks and nothing else.
/// It is given the live database's password, by a reference CloudFormation resolves, so that the migration
/// task can be pointed at it with nothing changed but the host. It keeps no backups, so that nothing of it
/// outlives the stack. The subnet group and the security group are parameters the script reads from the
/// live instance, because naming them from the Data stack would add outputs to it.
/// </remarks>
public sealed class MoveRehearsalStack : Stack
{
    public MoveRehearsalStack(Construct scope, string id, IStackProps props, Move move, DataStack data)
        : base(scope, id, props)
    {
        var subnetGroup = new CfnParameter(this, "LiveSubnetGroup", new CfnParameterProps
        {
            Type = "String",
            MinLength = 1,
            Description = "The live database's subnet group, so that the stand-in is in the same isolated subnets",
        });
        var securityGroup = new CfnParameter(this, "LiveSecurityGroup", new CfnParameterProps
        {
            Type = "AWS::EC2::SecurityGroup::Id",
            Description = "The live database's security group, which admits the API's tasks and nothing else",
        });

        var standIn = new CfnDBInstance(this, "StandIn", new CfnDBInstanceProps
        {
            DbInstanceIdentifier = move.StandInIdentifier,
            Engine = "postgres",
            EngineVersion = DataStack.DatabaseEngineVersion.PostgresFullVersion,
            DbInstanceClass = $"db.{DataStack.DatabaseInstanceType}",
            AllocatedStorage = DataStack.DatabaseStorageGiB.ToString(CultureInfo.InvariantCulture),
            StorageType = "gp3",
            StorageEncrypted = true,
            MultiAz = false,
            PubliclyAccessible = false,
            DbName = DataStack.DatabaseName,
            MasterUsername = DataStack.DatabaseUser,
            MasterUserPassword = SecretValue.SecretsManager(move.Source.DbSecretName,
                new SecretsManagerSecretOptions { JsonField = "password" }).UnsafeUnwrap(),
            DbSubnetGroupName = subnetGroup.ValueAsString,
            VpcSecurityGroups = [securityGroup.ValueAsString],
            BackupRetentionPeriod = 0,
            DeleteAutomatedBackups = true,
            DeletionProtection = false,
            EnablePerformanceInsights = false,
        });
        standIn.ApplyRemovalPolicy(RemovalPolicy.DESTROY);

        var logs = MoveTasks.Logs(this, move.DumpLogGroup);
        var into = new MoveIn(this, "In", move, standIn.AttrEndpointAddress, data.DbSecret, logs);
        var from = new MoveOut(this, "Out", move, data.Database.InstanceEndpoint.Hostname, data.DbSecret, logs);

        MoveTasks.Output(this, "DumpTaskFamily", from.Task.Family);
        MoveTasks.Output(this, "RestoreTaskFamily", into.Task.Family);
        MoveTasks.Output(this, "DumpLogGroup", logs.LogGroupName);
        MoveTasks.Output(this, "RestoreLogGroup", logs.LogGroupName);
        MoveTasks.Output(this, "BucketName", into.Bucket.BucketName);
        MoveTasks.Output(this, "StandInEndpoint", standIn.AttrEndpointAddress);
        MoveTasks.Output(this, "StandInIdentifier", move.StandInIdentifier);
    }
}
