# 0107. Production keeps fourteen days of backups, and a restore has been rehearsed

**Status:** Implemented. Production's `Data` stack is not deployed yet, so its number is in no live
database; the rehearsal was on dev's. Adds a fourth member to the `Site` of
[0103](0103-production-is-the-same-stacks-behind-an-approval.md) §2.

## Context

Every environment's database has kept seven days of automated backups since `DataStack` was written:
RDS's snapshot a day and the transaction log between them, from which the database can be put back as it
was at any moment in the window. Beside them the instance refuses deletion, and is snapshotted if the
stack ever lets go of it. No record says why seven.

**None of those backups had been restored.** Dev has held its testers' real lists since 2026-11-21, which
move to production at launch (#465), so the first rehearsal was owed there, and is the restore drill of
#440.

On 2026-11-23 the owner asked what gives production its backups, as the piece of production that matters
most, and what was missing was said: no restore had been tried, the window was seven days, the backups
are in the database's own account and Region, and no steps were written down.

## Decision

### 1. Fourteen days for production, seven for any other environment

`Site.BackupRetentionDays`, which `DataStack` reads where it said seven.

- **Longer than seven**, because damage is found late. A migration or a bug that quietly drops rows is
  noticed when somebody goes looking for what is gone, and on a site this size that can be more than a
  week.
- **Fourteen and not the thirty-five RDS allows** is the owner's call, made that day. AWS's guide: "You
  can set the backup retention period of a DB instance to between 0 and 35 days"
  ([backup retention period](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.BackupRetention.html)).
- **Cost is not what decides it.** AWS's guide: "Amazon RDS provides a free amount of backup storage equal
  to 100 percent of the total provisioned database storage in your AWS account for each Region"
  ([automated backups](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html)).
  Past that it is $0.103 a GB-month in Frankfurt for PostgreSQL (AWS's Price List API, `ChargedBackupUsage`,
  published 2026-11-20). The volume is 20 GB, and dev's database had 18.3 GB of it free that day, so
  the backups of a database this size would have to grow past ten times its data before the first cent.
  What fourteen days of them come to could not be read ahead of time: CloudWatch's backup metrics for
  dev's instance returned nothing.
- **Dev's stays seven.** Its data moves to production at launch, and a change to its number is a `Data`
  deploy on the one database that holds real data today, for a trial that ends first.
- **The number can change on a live database.** The same page of the guide names one case as an outage:
  "if you change the backup retention period of a DB instance from 0 to a nonzero value or from a
  nonzero value to 0". It says nothing either way of a change between two numbers above zero.

### 2. A restore is rehearsed, and its steps are in `infra/README.md`

Dev's latest backup was restored on 2026-11-23 to a new instance beside the live one, in the same
isolated subnets and behind the same security group. RDS's events put the restore eight minutes after
the request. A task inside the VPC then read both databases in a session that cannot write: the
server's version, the newest migration and the row count of every table. The copy's twenty-nine lines
were the live database's. The copy was deleted the same hour, and the live database was read twice and
never written.

The four steps, their commands, the task's definition and the times are **Restoring the database** in
`infra/README.md`, which is where the next restore will be looked for. This record holds only that it was
done and what it showed.

### 3. What neither of these gives

- **Putting a restored copy in service.** The rehearsal stopped at a copy that could be read, since dev
  was in use. AWS's guide gives renaming as the way to swap one in: "By renaming the database, you can
  replace the DB instance without having to change any application code that references the DB instance"
  ([renaming a DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_RenameInstance.html)).
  The stack names the instance by its identifier, and what CloudFormation makes of the swap is not known.
  It is to be tried on production before the door opens, when nobody is using it, and is a line on #440.
- **Anything older than the window.** Nothing keeps a longer copy.
- **A copy outside the account and the Region.** The backups are where the database is. Whether that is
  enough for production is the other line on #440.
- **A standby.** Backups put back what was damaged or deleted; they do not keep the database answering
  when its hardware fails. That is [#416](https://github.com/ChronosSF/myvideogamelist/issues/416)'s,
  which [0108](0108-production-launches-without-a-nat-gateway-and-in-one-zone-until-the-site-earns-them.md)
  leaves until the site earns it.

## Consequences

- **Production's database keeps fourteen days from the day `Data` is first deployed.** Dev's templates do
  not change: both environments were synthesised from master and from this change, and dev's seven
  templates are the same.
- **CI holds the number.** `scripts/site.mjs` restates it, and `scripts/check-site.mjs` compares it with
  the instance's `BackupRetentionPeriod` in each synthesis, reading it with no default.
- **`Site`'s differences for production are four**, where 0103 §2 counted three.
- **The steps are proved on a small database.** Dev's is 20 GB allocated and its largest tables hold a
  few hundred rows, so the eight minutes are RDS's own time, not the data's.
