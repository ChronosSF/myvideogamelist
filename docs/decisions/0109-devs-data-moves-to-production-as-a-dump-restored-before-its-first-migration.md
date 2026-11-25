# 0109. Dev's accounts and lists move to production as a dump, restored into its empty database before its first migration

**Status:** Accepted; built, and rehearsed inside dev's account on 2026-11-25. Nothing of it is in
production's account, whose database does not exist yet. Part of
[#465](https://github.com/ChronosSF/myvideogamelist/issues/465). Changes the order of
[0103](0103-production-is-the-same-stacks-behind-an-approval.md) §7's first deploy, and what
[0102](0102-a-deployed-admin-is-a-hand-set-parameter-the-task-reads.md)'s parameter holds on production
before it. Reads the database the way the restore drill of 0107 did (#505).

## Context

Dev has held the testers' real accounts and lists since 2026-11-21, and they have been told those land on
production at launch. Production's database will be made by its own `Data` stack, in another account, and
none of its application stacks is deployed yet (0103).

**A snapshot cannot cross.** Dev's database is encrypted with the account's default key, and AWS's guide
says: "You can't share a snapshot that has been encrypted using the default KMS key of the AWS account
that shared the snapshot"
([sharing an encrypted snapshot](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/share-encrypted-snapshot.html)).
The way round it the guide gives is a copy under a key of our own, shared with the other account. Even
then, a snapshot is restored as a new instance, outside the `Data` stack that is meant to own production's
database, and putting a restored instance in service is the step the restore drill left untried.

**What is being moved is small.** Dev's database is 20 GB allocated and under 2 GB used; its dump in
pg_dump's custom format was 347,340 bytes on the day of the rehearsal.

**The owner's cost rule** ([0108](0108-production-launches-without-a-nat-gateway-and-in-one-zone-until-the-site-earns-them.md),
#505): a one-off cost of cents is fine, a recurring one is not.

## Decision

### 1. A dump and a restore, each by a task in its own account's network

Nothing outside a VPC reaches either database, so each end is a one-off Fargate task in that environment's
task subnets, behind the API's security group, as the migration task runs.

- **The dump's half, `Mvgl-dev-MoveOut`**, in dev's account: a task that counts the database, dumps it,
  counts it again, and writes the dump into production's bucket. Its sessions start read-only
  (`default_transaction_read_only`), and nothing in the task turns that off.
- **The restore's half, `Mvgl-prod-MoveIn`**, in production's account: the bucket, and a task that fetches
  the dump, restores it into production's database, and counts the copy in a session that cannot write.
- **Each task is two containers sharing the task's own storage**: PostgreSQL's image, for pg_dump,
  pg_restore and psql of the server's major version, and AWS's CLI, pinned, for the bucket. The second
  starts once the first has stopped, which ECS's `COMPLETE` condition gives: "a dependent container runs to
  completion (exits) before permitting other containers to start"
  ([container dependency](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html)).
  It acts only if the first left its mark, so the task's exit code says whether the whole of it worked.
- **The counts are what is compared**: the newest migration and how many there are, every table's row
  count, and every sequence's last value, read the same way before the dump, after it and from the copy.
  Names and numbers, nothing of anybody's. Each side also prints the dump's SHA-256, so the bytes the
  restore read can be held to the bytes the dump wrote.
- **`scripts/move-data.mjs`** runs it, in the manner of `dev-env.mjs`: `rehearse`, and the day's `dump`,
  `restore` and `clean`.

The dump never leaves AWS: no step downloads it to a machine, and no line of any log holds a row.

### 2. It crosses in a bucket in production's account, which holds it for minutes

`Mvgl-prod-MoveIn` makes `mvgl-prod-move-381466680659`, and that bucket is the whole of what production
needs for the move beside the restore task and its roles. Nothing changes in its `Data` stack.

- **Encrypted at rest.** The bucket's default is SSE-S3, which S3 applies to every new object anyway:
  "All new object uploads to Amazon S3 buckets are encrypted by default with server-side encryption with
  Amazon S3 managed keys (SSE-S3)"
  ([server-side encryption](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingServerSideEncryption.html)).
  Not a key of our own, which the write from another account would need a key policy for. On its way through each task the dump lies on the task's storage, which for Fargate "is encrypted
  with an AES-256 encryption algorithm"
  ([Fargate task storage](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/fargate-task-storage.html)),
  and the last container deletes it as it exits.
- **Reached by nothing but the two tasks.** The bucket blocks public access and refuses any request not
  over TLS. Its policy admits dev's account to write the one object only on the condition that the caller
  is the dump task's role, and denies every principal but that role a write and every principal but the
  restore task's role a read. A role is named by `aws:PrincipalArn`, for which "the request context returns
  the ARN of the role, not the ARN of the user that assumed the role"
  ([condition keys](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html)),
  and by its name rather than as a principal, for the reason `EmailStack` records. The dump's role in dev
  may write that one object and nothing else, and the upload names the account the bucket must belong to
  (`s3api put-object --expected-bucket-owner`): "If the account ID that you provide does not match the
  actual owner of the bucket, the request fails"
  ([PutObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_PutObject.html)).
- **Production owns what dev writes.** With object ownership "Bucket owner enforced", "ACLs are disabled,
  and the bucket owner automatically owns and has full control over every object in the bucket"
  ([object ownership](https://docs.aws.amazon.com/AmazonS3/latest/userguide/about-object-ownership.html)),
  so the restore task can read an object another account wrote.
- **Deleted after.** `move-data.mjs clean` deletes the object as soon as the restore has been compared,
  reads the bucket empty, and destroys both halves; a stack whose bucket still holds anything does not
  destroy. The bucket keeps no older versions, and expires what it holds after a day as a
  backstop, which is no promise: S3 "queues the object for removal and removes it asynchronously"
  ([lifecycle expiration](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-expire-general-considerations.html)).
- **No recurring cost.** Both halves are deployed by hand before the day and destroyed after it. Nothing
  else of them stays: their task definitions are deleted, and their logs go with their stacks.

### 3. The dump brings its schema, and is restored into production's database before its first migration

Production's `Data` stack makes a database that holds nothing. The restore writes into that, and only into
that: a database that holds any relation outside PostgreSQL's own schemas is refused with exit code 3, so
the task cannot be run over a database in service. It restores in one transaction, which "ensures that
either all the commands complete successfully, or no changes are applied"
([pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)), so a restore that fails leaves the
database as empty as it found it, and can be run again.

So **the restore comes before production's first `dev-env.mjs resume --env prod`**, which migrates the
database before anything else, and production's database is never migrated before the move.

- **`__EFMigrationsHistory` comes with the dump**, so the first resume's migration finds dev's migrations
  applied and applies only what is newer: in a migration bundle, "migrations are applied to the database
  only if they have not been already applied"
  ([applying migrations](https://learn.microsoft.com/en-us/ef/core/managing-schemas/migrations/applying)).
  In the rehearsal, dev's migration task, at dev's tag and pointed at the restored copy, said "No
  migrations were applied. The database is already up to date." and exited 0.
- **The seeded rows come with it.** `ListStatuses` and `PlaythroughTypes` arrive as dev has them, which are
  the rows the same migrations seeded, and no migration seeds them again, since none runs again.
- **Every identity sequence comes with its value.** pg_dump counts them as data ("Table data, large
  objects, and sequence values are dumped", [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html)),
  so a new row on production takes the next id after dev's last. In the rehearsal every sequence's last
  value on the copy was the live database's.
- **Statistics do not.** pg_dump leaves them out unless asked ("Do not dump statistics. This is the
  default."), and pg_restore's guide says that "if not all statistics were restored, it may be useful to
  run ANALYZE on each restored table", so the restore runs `ANALYZE` on the copy before counting it.
- **Both sides are on one commit.** Dev's database is at the migrations its migration task last ran, and
  production's first resume deploys production's newest tag. On the day, `Deploy dev` and `Deploy prod`
  run from the same head of master with nothing merged between them; `dump` prints the tag dev's database
  was migrated at, to hold production's to. A newer tag on production would only run its new migrations on
  the restored rows, as a release does on dev; an older one never runs, because its code would meet a
  schema it does not know.

**Rejected: restoring the data alone into a database the migration task has built.** It would let
production be deployed whole before the day and shorten the day to the dump and the restore. But the
migrations' own rows, `ListStatuses`, `PlaythroughTypes` and the history, would be on both sides and
collide; every table would have to be loaded in an order its foreign keys allow; and production's own API,
already running, would be writing `CachedGames` from its refresh while the copy arrived. Restoring a whole
database into an empty one has none of that, and the empty database is what makes the refusal above
possible.

### 4. Everything moves, `CachedGames` included

The dump is the whole database, with nothing left out, so that what is compared is everything.

- **`CachedGames`** could be rebuilt from IGDB, but a list renders from it (0035) and the sitemap reads it.
  Without it every tracked game would be asked of IGDB on its first view, through four calls a second the
  whole site shares, in the hour after the launch. Its rows keep their `RefreshedAt`, so the refresh takes
  them up when they come due, as it would have on dev.
- **A pending import** moves with its rows, at the same address. Its fourteen days count from its
  `UpdatedAt` (0038), so a job left untouched on dev for thirteen is swept on production a day after.
- **A reader's report** in `ContentReports` moves, and is answered on production.
- **The admin.** Account ids move unchanged, so `/mvgl/prod/admin-account-id` holds dev's admin's id from
  before production's first `App` deploy rather than `none` (0102). Until the restore it names an account
  that is not there yet, which matches nobody, as `none` does.
- **Sessions do not move.** Each environment has its own key ring (0043), so everybody signs in once on
  production, with the same password. An unclicked confirmation or reset link dies with dev's key ring; an
  account that was never confirmed arrives unconfirmed, and signing in with its password offers the link
  again (0089).
- **Test accounts are deleted on dev before the move**, by their owner, and dev's copy is wiped after it,
  by the same hand. Nothing in the move does either.

### 5. What the dump does to the live site

The rehearsal dumped dev's database while dev was open, which is what the day avoids, so what it does to a
site in use is known from PostgreSQL's guide and from how long it took.

- **Readers and writers do not wait for it.** pg_dump's guide: it "does not block other users accessing the
  database (readers or writers)". The lock it holds on each table until it ends, a shared one, "conflicts
  with the ACCESS EXCLUSIVE lock mode only"
  ([explicit locking](https://www.postgresql.org/docs/18/explicit-locking.html)), which the API's reads and
  writes never take.
- **A migration does wait for it.** "Many forms of ALTER INDEX and ALTER TABLE" take that exclusive lock,
  as `DROP TABLE` and `TRUNCATE` do, and the migration task gives up after five seconds (0079): a release whose migration meets a dump fails with
  `55P03` and is run again. The dump itself waits at most five seconds for any table
  (`--lock-wait-timeout`, which makes pg_dump "fail if unable to lock a table within the specified
  timeout"), so it never queues readers behind a migration waiting for its turn. Neither side starts while
  the other is running: `move-data.mjs` refuses while a migration task runs.
- **The API's session limits are its own.** The minute an API transaction may sit idle (0079 §2) is set on
  the API's connection string, so it does not reach the dump's session.
- **On dev it held its locks for about a second**: pg_dump's own time, by its task's log, in each of the
  two rehearsal runs that reached it. The counts read just before and just after it were the same. On the
  day dev's API is stopped first, so nothing is held up at all.

### 6. The day, in order

What each step is run with is **Moving dev's accounts and lists** in `infra/README.md`.

Ahead of the day: a second rehearsal the week before; production's `EdgeCert`, `Data` and everything set by
hand that 0103 §7 lists, the admin's parameter holding dev's admin's id, but not production's first
`resume`; the test accounts deleted; both halves deployed; and the members told on Discord when dev stops
and that they will sign in again at `myvideogamelist.net` with the same password.

On the day:

1. `Deploy dev` and `Deploy prod` from the same head of master.
2. **Dev stops taking writes.** The pipeline's gate goes off, so no run brings the API back, and the API
   is scaled to nothing; it is the only writer, its background work included. `dump` refuses until it is.
3. `move-data.mjs dump`. It fails if the counts moved while it ran, before production is touched.
4. `move-data.mjs restore`, which compares the copy with what the dump counted and the digest with the
   dump's.
5. `move-data.mjs clean`: the dump deleted, both halves destroyed.
6. 0103 §7's steps 6 to 9: the first `resume`, the holding page destroyed, the second `resume`, the
   acceptance test.
7. The owner signs in through the door as the admin, and finds their lists and `/admin`.
8. The door opens (0103 §5), and the members are told.
9. Dev is parked.

**What members see.** Ahead of it, the announcement. From step 2 on dev, every page that needs the API
answers the site's error page, titled "502 Bad Gateway" with the sentence of the page that failed, and a
write fails; nothing done there is saved. Pages the edge holds, a
game's for up to an hour, still show. At the domain, the holding page answers until step 6 destroys it,
and the door's password prompt until step 8. A notice of the site's own on dev, saying why, would be
kinder, and is a line on #465.

### 7. Going back

- **Until the door opens, nothing is lost.** Dev's database is only ever read. Going back is `clean`, dev's
  API scaled back to one task and its gate back on, and the members told the move is later.
- **A dump that fails, or whose counts moved,** has written nothing to production. It is run again; the
  next dump replaces the object.
- **A restore that fails** leaves production's database empty, by its one transaction, and is run again
  from the same dump.
- **A restore that succeeded but does not compare** leaves production's database holding the copy, and the
  next restore refuses it. Production's database has never served anybody at that point, so it can be
  emptied, but how is not rehearsed, and is a line on #465. The door stays shut, and dev is brought back
  as above.
- **After the door opens** there is no going back that keeps what members did on production.

### 8. What only the day can prove

The rehearsal ran both halves in dev's account, into a stand-in made as `Data` makes a database. These
need production's account, and production's database:

- **The write across accounts**: dev's role writing into production's bucket, which the bucket policy's
  account principal and its condition have to admit, and `--expected-bucket-owner` naming another account.
- **The read of an object another account wrote**, which object ownership is meant to make production's.
- **Production's database as its `Data` stack makes it**, with whatever minor version RDS gives a new
  PostgreSQL 18 instance that day (the stand-in was given 18.3, dev's), and the restore into it.
- **That production's first `resume` finds nothing to migrate** at production's tag.
- **That the deny statements hold against an administrator of production's account.** Not tried.
- **That every member can sign in** with the password they had, and that the admin's id opens `/admin`:
  shown by the owner signing in through the door, before it opens.
- **How long the day takes**, with production's first `App` deploy in it.

## Consequences

- **Dev's synthesis holds two more stacks, `MoveOut` and `MoveRehearsal`, and production's one, `MoveIn`.**
  Dev's seven existing templates and production's eight are byte for byte what they were: the new stacks
  read only the two `Data` outputs the `Migrate` stack already reads, and are made after the per-release
  stacks, because `Data` writes its outputs in the order their consumers are made.
- **`DataStack` names the database's engine, class, size, name and user once**, and the rehearsal's
  stand-in reads them, so a change to production's database changes the stand-in with it.
- **Each rehearsal costs cents and leaves nothing.** `move-data.mjs rehearse` removes what it made and reads
  the account to show it, and refuses to remove a rehearsal stack it did not make.
- **After the launch** the three stacks, `MoveStack.cs`, `move-data.mjs` and the runbook's section go, as
  the holding page's stack does once production holds the domain.
- **The rehearsal of 2026-11-25 took three runs**, and each removed everything it made, which the account
  was read to show. The first failed at its first line: the scripts are C# raw strings, which kept a
  Windows checkout's CRLF, and sh read `pipefail` with a carriage return after it. The dump's container
  stopped before it ran psql, so it never connected to dev's database. Every script now passes through a
  function that makes its line endings Unix's, which also makes the template the same wherever it is
  synthesised. The second dumped dev's database and failed at the upload, since `aws s3 cp` does not take
  `--expected-bucket-owner`; the upload and the download became s3api's `put-object` and `get-object`,
  which do. The third went through, in fourteen minutes from the first command to an account read clean.
  The times and what was compared are in `infra/README.md`. The stand-in ran for about forty minutes
  across the three, which is cents.
