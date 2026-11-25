# infra

The AWS environment, as one CDK app in C#. What it builds and why is ADR 0044; the records it
rests on are 0007, 0014, 0015 and 0043.

Seven stacks, split by lifetime, named `Mvgl-<env>-<part>`:

| Stack | Lifetime | Holds |
|---|---|---|
| `Dns` | permanent | the environment's public hosted zone |
| `Data` | long-lived | VPC, security groups, RDS, secrets (IGDB's and Turnstile's set by hand), ECR, the cluster, the regional certificate, the GitHub deploy role, the basic-auth store, the origin-verify secret |
| `EdgeCert` | long-lived, `us-east-1` | the certificate CloudFront uses |
| `Alerts` | long-lived | the topic the alarms send to, and the owner's email subscription to it (ADR 0080) |
| `Migrate` | each release | the task that runs the migration bundle |
| `Waf` | disposable, `us-east-1` | the web ACL on the distribution, its one rate rule, and the log of what it refuses (ADR 0098) |
| `App` | disposable | the balancer, both services, the distribution in front of the balancer, the DNS alias, the alarms |

Context: `env` (required) and `imageTag` (the git SHA; without it `Migrate` and `App` synthesise
with an error the CLI refuses to deploy over, so nothing falls back to `latest`).

```bash
cdk synth --profile mvgl-dev -c env=dev -c imageTag=<sha>
cdk deploy Mvgl-dev-Data --profile mvgl-dev -c env=dev
```

An environment has one account, and the app refuses to synthesise it with another's credentials:
`-c env=dev` goes with `--profile mvgl-dev` and `-c env=prod` with `--profile mvgl-prod`. The other
pairing stops before any stack is made, naming both accounts.

The CLI the pipeline runs is the one `package-lock.json` here pins, which CI audits and synthesises
with: `npm ci` here installs it, `npx cdk …` runs it, and `scripts/dev-env.mjs` runs it once it is
installed (#339). A `cdk` installed globally is whatever version it was when installed.

The long-lived stacks are deployed from a developer machine; the pipeline deploys `Migrate` and
`App` only, as the deploy role the `Data` stack creates, and `scripts/dev-env.mjs` makes and destroys
`Waf` around `App`. The balancer admits CloudFront's
origin-facing prefix list and nothing else, so there is no way to reach the environment except
through the distribution, and no parameter that would open one.

## Production

`-c env=prod` synthesises the same stacks in the production account, less `Dns`, and beside them
`Mvgl-prod-Holding`, below, and `Mvgl-prod-Email`, in the next section. Of the application's own,
none is deployed yet (ADR 0103). What differs from dev is three members of `Site`:

- **`www` only redirects to the apex.** The edge certificate covers it, `App` points it at the
  distribution, and the viewer-request function answers it, and any other name, with a 301 to the same
  address on the host.
- **The site is indexable.** The SSR server is given `SITE_INDEXABLE=true` (ADR 0036).
- **It is behind basic auth until a pull request opens it**, which is the launch: `Site.BehindBasicAuth`.

Three things to know before deploying any of it:

- **It looks the domain's zone up, and never creates one.** `EdgeCert` asks, from `us-east-1`, where
  the holding page's stack already cached the answer, and hands the zone to the other stacks.
- **Its lookups are cached and committed**, as dev's are: the Region's availability zones and
  CloudFront's prefix list, beside the zone. CI synthesises production with `--no-lookups`, so a stack
  that asks a new one fails there until a synthesis with the profile signed in has written the answer
  into `cdk.context.json` and it is committed:

  ```bash
  npx cdk synth --profile mvgl-prod -c env=prod -c imageTag=000000000000 --quiet
  ```

- **The profile's Region has to be the one SES is in**, `Site.EmailRegion`. Production's alarms send to
  the topic `Mvgl-prod-Alerts` makes there, and an alarm can only tell a topic in its own Region, so
  `App` carries an error when it is synthesised for another.

### Before the first deploy

In this order, and any time before the day:

1. `EdgeCert` and `Data`, by name. `Alerts` is there already, for SES.

   ```bash
   npx cdk deploy Mvgl-prod-EdgeCert Mvgl-prod-Data --exclusively --profile mvgl-prod -c env=prod
   ```

   `EdgeCert`'s certificate covers the names the holding page's does, in the same account, so it is
   validated by records that are already in the zone. Nothing AWS documents says CloudFormation
   accepts that; if it did not, this is where it would fail, with the holding page untouched
   (ADR 0103 §3).

2. What is set by hand, each as dev's was: IGDB's pair in `mvgl/prod/igdb`, a widget's pair in
   `mvgl/prod/turnstile` ([Turnstile, for sign-up](#turnstile-for-sign-up)), the basic-auth pair in the
   `mvgl-prod-basic-auth` store ([The edge](#the-edge)), and `/mvgl/prod/admin-account-id` holding
   dev's admin's account id, which the move carries over unchanged, rather than `none`
   ([Who the admin is](#who-the-admin-is), ADR 0109).
3. The `prod` GitHub environment: required reviewers, deployments from `master` only, the variables
   `AWS_ROLE_ARN` (`Data`'s `DeployRoleArn` output), `AWS_REGION`, `AWS_ACCOUNT_ID` and
   `PROD_DEPLOY_ENABLED` set to `false`, and the secret `PROD_BASIC_AUTH`, the pair as
   `user:password`.
4. A run of `Deploy prod`, approved. With the gate off it builds master's two images, pushes them to
   production's repositories and stops.

### The first deploy

Made by hand, because it takes the domain from the holding page, and the pipeline only ever updates
an application stack that exists. **Dev's accounts and lists go first**: the first `resume` migrates the
database, and the move restores only into one that holds nothing, so the day starts with
[Moving dev's accounts and lists](#moving-devs-accounts-and-lists) and comes here at its step 6.

```bash
node scripts/dev-env.mjs resume --env prod
npx cdk destroy Mvgl-prod-Holding --profile mvgl-prod -c env=prod
node scripts/dev-env.mjs resume --env prod
node scripts/dev-check.mjs --env prod
```

The first `resume` runs while the holding page still answers. It migrates the database at the newest
pushed tag, deploys `Waf`, and stops before `App`, naming the holding page's stack: neither step uses
the holding page's names, so whatever goes wrong in production's first migration or its first web ACL
costs the domain nothing. The domain answers nothing from the destroy until the second `resume` has
finished. That one finds the migration and `Waf` done, deploys `App`, proves the door is on and sets
`PROD_DEPLOY_ENABLED`. Run the check with `MVGL_PROD_BASIC_AUTH` set to the pair and the profile
signed in. After that, a release is a run of `Deploy prod`.

**The check also asks for the certificate's validation records**, which the holding page's
certificate shared and ACM's renewal needs in public DNS (ADR 0103 §3). If it finds one gone, the
destroy took it: put it back in the zone as ACM gives it, a CNAME, in the Route 53 console or with
`aws route53 change-resource-record-sets`. The ARN is `Mvgl-prod-EdgeCert`'s `CertificateArn` output.

```bash
aws acm describe-certificate --profile mvgl-prod --region us-east-1 --certificate-arn <arn> --query "Certificate.DomainValidationOptions[].ResourceRecord"
```

`dev-env.mjs park --env prod` refuses: production is not parked.

### The holding page, until production takes the domain

`Mvgl-prod-Holding`, whole in `us-east-1`, serves `holding/site` at `myvideogamelist.net` from a
private bucket through a distribution, and sends `www` to the apex (ADR 0066).

```bash
cdk deploy Mvgl-prod-Holding --profile mvgl-prod -c env=prod
```

- **The account needs a CDK bootstrap in `us-east-1` first, once.** Run it from the repository root,
  not from here: the CLI builds the app wherever it finds a `cdk.json`, and the app refuses to build
  without an `env`.

  ```bash
  cdk bootstrap "aws://$(aws sts get-caller-identity --profile mvgl-prod --query Account --output text)/us-east-1" --profile mvgl-prod
  ```

- **It looks the domain's zone up too.** The zone was made by hand in that account and holds the mail
  records and dev's delegation. Its lookup is the one already in `cdk.context.json`.
- **A change to the page is a change to `holding/site` and the same command.** The deployment
  replaces the bucket's contents, then invalidates the distribution and waits for it.
- **The Search Console record is in the zone by hand, never in the stack.** The stack is destroyed
  when production takes the domain, and the record has to outlive it.
- **Production's App stack cannot deploy with the domain while this stack holds it.** CloudFront
  gives an alternate domain name to one distribution at a time, and the records would collide too:
  destroy this stack first. The destroy empties the bucket itself. `dev-env.mjs resume --env prod`
  refuses to deploy `App` while this stack exists.

### Moving dev's accounts and lists

Dev's database moves into production's at launch, before production's first migration (ADR 0109). A task
in dev's VPC dumps it, in a session that cannot write, into a bucket in production's account; a task in
production's VPC restores it into production's database, which has to hold nothing, in one transaction.
Each counts what it read: the migrations, every table's rows and every sequence, and the dump's digest.
`scripts/move-data.mjs` runs them and compares the counts. The stacks are `Mvgl-dev-MoveOut` and
`Mvgl-prod-MoveIn`, deployed by hand for the day and destroyed after it.

**Rehearsed on dev on 2026-11-25**, inside dev's account, into a stand-in made as `Data` makes a
database, while dev was open. Times are UTC.

| | |
|---|---|
| Started | 09:45:39, from `node scripts/move-data.mjs rehearse` |
| The stack, the stand-in included | 09:45:48 to 09:51:42, 5 m 54 s. RDS made the stand-in PostgreSQL 18.3, as dev's is |
| The dump | 09:51:46 to 09:53:03, 1 m 17 s for the task. pg_dump 18.7 ran for a second and wrote 347,340 bytes, and the upload took 4 s |
| The restore | 09:53:03 to 09:54:08, 1 m 6 s for the task. The download took 4 s and pg_restore under a second |
| The second restore | 09:54:08 to 09:55:15, refused as it should be: the stand-in held 113 relations |
| Dev's migration task, at dev's tag, on the stand-in | 09:55:15 to 09:56:20: "No migrations were applied. The database is already up to date." |
| What was compared | the live database just before the dump, just after it, and the copy: the same 39 lines, 35 migrations, the row count of each of 27 tables and the last value of each of 11 sequences. The digest the restore read was the one the dump wrote |
| Removed | 09:56:20 to 09:59:36, 3 m 16 s, and the account read clean |

Most of each task's minute is Fargate starting it, not the data, which is small. Two runs before this one
failed and removed what they had made: why, and what changed, is ADR 0109's last paragraph. After it, the
review of #507 made the restore take its dump by digest (exit code 5 for any other) and give a failure
after its commit a code of its own (4). Those were run against the compose database and a throwaway
server, not yet in AWS; the next rehearsal runs them there, a refused dump included.

#### Ahead of the day

1. **Rehearse again**, the week before, with the `mvgl-dev` profile signed in. It deploys
   `Mvgl-dev-MoveRehearsal`, dumps the live database, restores into a stand-in, restores again to see it
   refused, migrates the stand-in, compares, and removes everything, then reads the account to show it.
   Cents, once:

   ```bash
   node scripts/move-data.mjs rehearse
   ```

   `--keep` stops before the removal; `node scripts/move-data.mjs clean --rehearsal` does it later, the
   same day, since the stand-in bills by the hour and holds everybody's data.
2. **Production's `EdgeCert` and `Data`**, and everything [Before the first deploy](#before-the-first-deploy)
   lists, with `/mvgl/prod/admin-account-id` holding dev's admin's id: ids move unchanged. **Not
   production's first `resume`**, which migrates the database: the restore refuses one that holds anything.
3. **Dev's test accounts deleted**, by their owner.
4. **The two halves**, from `infra/`:

   ```bash
   npx cdk deploy Mvgl-dev-MoveOut --exclusively --profile mvgl-dev -c env=dev
   ```

   ```bash
   npx cdk deploy Mvgl-prod-MoveIn --exclusively --profile mvgl-prod -c env=prod
   ```

5. **The members told**, on Discord: when dev stops, that their lists move, and that they sign in again
   at `myvideogamelist.net` with the same password.

#### On the day

Both profiles signed in, from the repository root.

1. **One commit on both sides.** Run `Deploy dev` and then `Deploy prod` from the same head of master,
   with nothing merged between them. `dump` prints the tag dev's database was last migrated at, and
   `node scripts/dev-env.mjs status --env prod` production's newest.
2. **Dev stops taking writes.** The gate first, so no run of Deploy dev brings the API back, then the API,
   which is the only writer, its background work included:

   ```bash
   gh variable set DEV_DEPLOY_ENABLED --repo ChronosSF/myvideogamelist --env dev --body false
   ```

   ```bash
   aws ecs update-service --profile mvgl-dev --cluster mvgl-dev --service api --desired-count 0
   aws ecs wait services-stable --profile mvgl-dev --cluster mvgl-dev --services api
   ```

   From here every page of dev's that needs the API answers the site's error page, "502 Bad Gateway", and
   nothing a member does there is saved.
3. **The dump.** It refuses while the API runs, and fails if the counts moved while it ran:

   ```bash
   node scripts/move-data.mjs dump
   ```

4. **The restore.** It first reads the newest dump's log in dev's account, and stops if its upload did not
   finish or its counts moved. Then it restores that dump and no other, named by its digest, and compares
   the copy with what the dump counted:

   ```bash
   node scripts/move-data.mjs restore
   ```

5. **The dump deleted** and both halves destroyed. It reads the bucket empty before it destroys:

   ```bash
   node scripts/move-data.mjs clean
   ```

6. **[The first deploy](#the-first-deploy)**, as it is written: the first `resume` finds dev's migrations
   applied and migrates nothing that is not newer, then the holding page goes and the second `resume`
   makes `App`.
7. **Sign in through the door as the admin.** Your lists are there and `/admin` opens.
8. **Open the door** (ADR 0103 §5), and tell the members.
9. **Park dev**: `node scripts/dev-env.mjs park`. Its database is wiped by its owner once production has
   run long enough that nothing will be wanted from it.

#### If something goes wrong

- **The dump fails, or says the counts moved**: production was not touched. Find what still writes, then
  `dump` again; the next dump replaces the object.
- **The restore stops before it starts**, because the newest dump's upload did not finish or its counts
  moved, or the restore task refuses with exit code 5 because the bucket holds another dump than that one:
  nothing was written. `dump` again.
- **The restore fails** before it says it restored: pg_restore runs in one transaction, so production's
  database is as empty as before. Run `restore` again from the same dump.
- **The restore is refused**, exit code 3: production's database already holds something, because its
  first `resume` ran before the move or a restore already succeeded. Nothing was written. How to empty it
  is not rehearsed (#465).
- **The restore committed and then failed**, exit code 4 or any failure after its "restored in" line:
  `ANALYZE` or the count of the copy did not finish, so nothing was compared. Production's database holds
  the copy and refuses another restore. Do not open the door; emptying it is not rehearsed.
- **The restore succeeded and does not compare**: do not open the door. As above, emptying production's
  database is not rehearsed.
- **Going back altogether**, at any point before the door opens: dev's database was only read. `clean`,
  then the API back and the gate on, and the members told:

  ```bash
  aws ecs update-service --profile mvgl-dev --cluster mvgl-dev --service api --desired-count 1
  ```

  ```bash
  gh variable set DEV_DEPLOY_ENABLED --repo ChronosSF/myvideogamelist --env dev --body true
  ```

- **After the door opens** there is no going back that keeps what members did on production.

#### What only the day proves

The rehearsal ran both halves in one account. The write into another account's bucket, the read of an
object another account wrote, the bucket's denials against production's own administrators, production's
database as its `Data` stack makes it, its first `resume` finding nothing to migrate, every member's
password, and the admin's id opening `/admin` are proved by the day itself, before the door opens (ADR
0109 §8).

## Production's SES, for dev's email

`-c env=prod` also synthesises two stacks in the Region the domain is verified with SES
(`eu-central-1`), which is production's own Region too. Both are long-lived, deployed by hand, and kept
when the holding page goes.

- **`Mvgl-prod-Email`** holds the configuration set every email is sent under, `mvgl-email`, and one role,
  `mvgl-dev-email`. The dev API's task role (`mvgl-dev-api-task`) assumes the role to send through
  production's SES, because production has SES production access and dev is in the sandbox (ADR 0088).
  The role may call `ses:SendEmail` on the domain's identity and the configuration set, from
  `noreply@myvideogamelist.net`, and nothing else. The configuration set sends nothing to an address
  that has bounced or complained, and publishes each bounce and complaint to the Alerts topic (ADR 0091).
- **`Mvgl-prod-Alerts`** is the Alerts stack as dev has it (see [Alarms](#alarms)): the topic
  `mvgl-prod-alerts` and the owner's email subscription to it. For now only SES publishes to it;
  production's alarms will, from #98.

**Once, in this order**, from `infra/` with the `mvgl-prod` profile signed in. In Git Bash, put
`MSYS_NO_PATHCONV=1` in front of the first command:

```bash
aws ssm put-parameter --profile mvgl-prod --region eu-central-1 --name /mvgl/prod/alarm-email --type String --value "<address>"
```

```bash
cdk deploy Mvgl-prod-Alerts --profile mvgl-prod -c env=prod
```

Then click the link in the "AWS Notification - Subscription Confirmation" email, within two days.

```bash
cdk deploy Mvgl-prod-Email --profile mvgl-prod -c env=prod
```

- **The account needs a CDK bootstrap in `eu-central-1` first, once**, as the holding page needed one
  in `us-east-1`. From the repository root:

  ```bash
  cdk bootstrap "aws://$(aws sts get-caller-identity --profile mvgl-prod --query Account --output text)/eu-central-1" --profile mvgl-prod
  ```

- **`Alerts` goes before `Email`.** SES publishes as itself, and the topic's policy is what admits it.
- **`Email` goes before any `App` deploy of a revision that names the configuration set.** The API names
  it on every send. Until the set exists and the role may use it, every send fails as not sent, with
  `NotFoundException` or `AccessDenied` in the API's log.
- **Every email dev sends counts against production's reputation**, bounces and complaints included. Send
  tests to addresses you own, or to SES's mailbox simulator.
- **The two account ids are in `Site.cs`**, because each side of the trust names the other. Neither is a
  secret, and `cdk.context.json` already named both.

**Proving it, after both deploys.** The set suppresses both reasons and has its destination:

```bash
aws sesv2 get-configuration-set --configuration-set-name mvgl-email --profile mvgl-prod --region eu-central-1 --query SuppressionOptions
aws sesv2 get-configuration-set-event-destinations --configuration-set-name mvgl-email --profile mvgl-prod --region eu-central-1
```

Then, once dev is up, sign up there with `bounce@simulator.amazonses.com`, and again with
`complaint@simulator.amazonses.com`. The inbox should receive a `Permanent` bounce and a complaint,
each with `mvgl-email` in its `ses:configuration-set` tag and the IAM identity that sent it in
`ses:caller-identity`. The mailbox simulator's mail does not count towards the account's rates, and
its addresses are never put on the suppression list, so this can be run again.

**When somebody's email never arrives**, the inbox will have had a bounce with the subtype
`OnAccountSuppressionList` for it: an earlier email to that address bounced, or they reported one as
spam. Once they say the mailbox works, lift it, and their next email goes:

```bash
aws sesv2 delete-suppressed-destination --email-address "<address>" --profile mvgl-prod --region eu-central-1
```

`aws sesv2 list-suppressed-destinations` lists every address on the list, with its reason and when it
was added. The account's own suppression setting should name both reasons too, as it did when this was
written (ADR 0091): `aws sesv2 get-account --query SuppressionAttributes`.

## Turnstile, for sign-up

Sign-up asks Cloudflare's Turnstile whether a person sent it (ADR 0092). Each environment has a widget of
its own, and its pair of keys lives in the secret `mvgl/<env>/turnstile`, which the `Data` stack makes with a
placeholder and the `App` stack hands to the API as `Turnstile__SiteKey` and `Turnstile__SecretKey`. The API
reads the placeholder as no keys at all: until the pair is set, `GET /api/auth/turnstile` and every sign-up
answer 503, with an error in the API's log, and the sign-up form says signing up is not available.

**Once per environment, before the first release that names the secret**, from `infra/` with the
environment's profile signed in:

1. **In Cloudflare's dashboard**, under Turnstile, add a widget: named for the site and the environment,
   with the environment's host (`dev.myvideogamelist.net`) and the mode **Managed**. It shows a site key
   and a secret key.
2. **Deploy the `Data` stack.** Its diff is one new secret and its output, and nothing else:

   ```bash
   cdk diff Mvgl-dev-Data --exclusively --profile mvgl-dev -c env=dev
   ```

   ```bash
   cdk deploy Mvgl-dev-Data --exclusively --profile mvgl-dev -c env=dev
   ```

3. **Set the pair**, in the console (Secrets Manager, `eu-central-1`, `mvgl/dev/turnstile`, "Retrieve
   secret value", then "Edit", one value for `SiteKey` and one for `SecretKey`), or from Git Bash:

   ```bash
   aws secretsmanager put-secret-value --profile mvgl-dev --region eu-central-1 --secret-id mvgl/dev/turnstile --secret-string '{"SiteKey":"<site key>","SecretKey":"<secret key>"}'
   ```

- **`Data` goes before the release.** The `App` stack reads the secret through the `Data` stack's new
  output, so a release before the deploy fails, and the revision before it keeps serving.
- **A task reads the pair when it starts.** A pair changed later reaches the API with the next release, or
  at once with `aws ecs update-service --cluster mvgl-dev --service api --force-new-deployment`.
- **Never one of Cloudflare's test keys.** A deployment given a test secret refuses to start, because it
  passes whoever asks.
- **Production** does the same with `-c env=prod` once #98 builds its `Data` stack, with a widget of its own
  for `myvideogamelist.net`.

**Proving it**: the sign-up form draws the widget, and `GET /api/auth/turnstile` answers the site key. A 503
there is the placeholder still in the secret, or a task started before the pair was set.

## The pipeline

`Deploy dev`, `.github/workflows/deploy-dev.yml`, runs by hand and only by hand, from the Actions tab or
with `gh workflow run deploy-dev.yml` (ADR 0099): a merge reaches dev when the owner chooses. What a
run does is `deploy.yml`, which that file calls for dev and `Deploy prod` calls for production, where
the `prod` GitHub environment asks its reviewers before the job starts (ADR 0103). What follows is
dev's, and production's is the same with its own names. The job
assumes the deploy role through OIDC - no AWS key is stored in GitHub - checks out master's head as it
starts, builds both images and pushes them tagged with that commit, and then stops unless
`DEV_DEPLOY_ENABLED` is `true` on the `dev` GitHub environment. Because it takes master's head
rather than the commit it was dispatched at, a run that waited behind another, or a re-run of an old
one, deploys master's newest and never an older commit; and one whose workflow file is no longer
master's stops before it builds, since it would run old steps against new code. Awake, it deploys `Migrate`, runs the migration task and fails the
release on a non-zero exit, deploys `App`, waits for both services, invalidates the distribution
and waits for that too, then checks target health and the site through the distribution: a 401
without the basic-auth pair, and with it `/readyz` and `/` answering 200; or, where the stack's
`BasicAuth` output is `off`, all three answering 200 with no pair (ADR 0101). The distribution id is
read from the `App` stack's outputs, since it changes on every resume. It never deploys `Waf`: `App`
reads the web ACL's ARN from that stack when it deploys, so a change to the rule reaches dev by hand or
with the next resume ([The rate rule](#the-rate-rule)).
Both deploys are `--exclusively`, and the `App` deploy only ever *updates* the stack: the gate is
read once, when the job starts, so a park that began mid-run would otherwise be undone by a job
that recreates the stack over a stopped database. Creating `App` is `resume`'s job alone. A
re-run for a commit whose images are already in ECR skips the build; the repositories are
immutable, so it could not push them again anyway. CI's Images job builds the same two images on
every pull request and pushes neither, reading the layer cache this workflow writes, so the two
cache scopes, `api` and `ssr`, change together (ADR 0061).

The `dev` environment holds four variables, none secret: `AWS_ROLE_ARN`, `AWS_REGION`,
`AWS_ACCOUNT_ID` and `DEV_DEPLOY_ENABLED`, and one secret, `DEV_BASIC_AUTH`, the basic-auth pair
as `user:password`, which only Deploy dev's smoke test reads; until it is set the authenticated checks are
skipped with a warning. The environment admits deployments from `master` only.
`scripts/dev-env.mjs park` and `resume` set the gate; nothing else should. The `prod` environment
holds the same three AWS variables, `PROD_DEPLOY_ENABLED` and `PROD_BASIC_AUTH`. Each caller passes
its secrets with `secrets: inherit`, because a called workflow's job gets its environment's secret
only when the caller passes it, and one that was not passed is empty there with no error. `deploy.yml`
names both secrets outright and takes the one for its environment: read by a name the caller passed,
as `secrets[...]`, it would have the runner handed every secret the job can read (ADR 0103 §6).

## Who the admin is

The API's task reads one account id from Parameter Store as it starts, `/mvgl/<env>/admin-account-id`,
as `Admin__AccountIds__0` (ADR 0042, 0102). No stack makes the parameter, so a park does not take it,
and the `App` stack does not deploy in an account where it is missing: CloudFormation looks for it
before it changes anything, and `dev-env.mjs resume` before it starts.

**Once per environment, before the first `App` deploy that reads it**, with nobody named. In Git Bash
put `MSYS_NO_PATHCONV=1` in front, since the name starts with `/`:

```bash
aws ssm put-parameter --profile mvgl-dev --name /mvgl/dev/admin-account-id --type String --value none
```

**To name the admin**, sign in as them on the site and read `id` from `/api/auth/me`. Write it, then
restart the API, which replaces its task by the service's usual rolling deployment:

```bash
aws ssm put-parameter --profile mvgl-dev --name /mvgl/dev/admin-account-id --type String --overwrite --value "<account id>"
```

```bash
aws ecs update-service --profile mvgl-dev --cluster mvgl-dev --service api --force-new-deployment
```

## The edge

CloudFront is one origin - the balancer - and decides only what is cached and what is forwarded;
the balancer goes on routing between the two processes. What each setting is for is ADR 0044's
CloudFront section, and `Edge.cs` says it again beside each one. Three things are not in the code:

- **The basic-auth credential lives in the KeyValueStore and is set by hand**, once, after the
  `Data` stack exists and before the first `App` deploy: with no key the function fails closed and
  every request is an error, not a 401. The value is the whole `Authorization` header:

  ```bash
  aws cloudfront-keyvaluestore put-key --profile mvgl-dev --kvs-arn <BasicAuthStoreArn output> --if-match "$(aws cloudfront-keyvaluestore describe-key-value-store --profile mvgl-dev --kvs-arn <BasicAuthStoreArn output> --query ETag --output text)" --key basic-auth --value "Basic $(printf '%s' '<user>:<password>' | base64)"
  ```

  Keep the pair to letters and digits. Nothing in the chain forbids other characters - the
  function compares the whole header byte for byte - but what a shell stores and what a browser
  sends for punctuation or accented letters are two encodings that have to agree, and the first
  pair set here did not pass the browser's prompt until it was simplified. Change the pair with
  the same command, then update the GitHub secret, or Deploy dev's smoke test fails with a 401.

  Three paths are exempt, because the client fetches them with `credentials: 'omit'` and the
  browser then withholds the `Authorization` header too: a game's reviews, community scores and
  community times (ADR 0044, D-8). The exemption is a regular expression in
  `src/Infra/functions/viewer-request.js`; a new public aggregate fetched the same way joins it there.

- **Whether an environment is behind it at all is one line**, `Site.BehindBasicAuth` (ADR 0101). Dev's
  is off while the trial runs: no behaviour names the function, which is still made, and the pair stays
  in the store. Putting the door back is that line, a merge and a run of Deploy dev. `park` takes the
  site away sooner than that.

- **The balancer answers only our distribution** (ADR 0046). The prefix list proves that a request
  came through *some* distribution; the `X-Origin-Verify` header, whose value is the
  `mvgl/<env>/origin-verify` secret, proves it came through ours, and the listener's default action
  is a 403. The value reaches the distribution and the listener as a Secrets Manager dynamic
  reference, so it is in no template and in no output. **Rotating it is not a redeploy**:
  CloudFormation generates the value once, on creation, and re-resolves a dynamic reference only
  for a resource whose template changed, so deploying `Data` and `App` again with nothing changed
  rotates nothing and renames nothing. The procedure is a new value written with `aws secretsmanager
  put-secret-value`, then an `App` deploy with a change that touches the origin's custom header and
  the listener's rules, which nothing here provides yet (#109). Until it does, the value lives as
  long as the secret.

- **The first deploy of this phase has an order**, because every cross-stack reference is resolved
  when the consuming stack deploys: `EdgeCert` in `us-east-1` (its certificate output is new),
  then `Data`, then the credential, then `App`. After that, `resume` and the pipeline need nothing
  but `App`.

- **The API takes a withdrawn profile off the edge itself** (ADR 0058): a profile made private,
  renamed or deleted, a review on it made private, edited or deleted, or everything recorded about
  a game deleted. `App` passes it the distribution's id as `CloudFront__DistributionId` and lets
  the API task role create invalidations on that distribution and do nothing else to it. Because
  the task definition refers to the distribution, a resume creates the API service only once the
  distribution exists, and a park deletes the API service before the distribution. Each task sends
  at most `CloudFront__DailyPathLimit` paths a UTC day (500 unless set), because every path past
  the account's free thousand a month is paid for. A withdrawal that cannot be invalidated
  logs its paths, so a stuck one can be sent by hand, each path quoted so the shell leaves its `*`
  alone:

  ```bash
  aws cloudfront create-invalidation --profile mvgl-dev --distribution-id <DistributionId output> --paths "/u/<publicId>*" "/sitemaps/profiles-*"
  ```

## The rate rule

One web ACL, `mvgl-<env>-edge`, on the distribution, with one rule, `requests-per-address`: an address that
sends more than 300 requests in five minutes, counting everything but `/assets/` and `/__manifest`, is
answered 429 until it slows down. Everything else is allowed. It is there so that no one address can spend the four IGDB calls a
second the whole site shares; why 300, and everything else about it, is ADR 0098, and the arithmetic is
beside `RequestsPerFiveMinutes` in `src/Infra/WafStack.cs`.

- **It lives in `Mvgl-<env>-Waf`, in `us-east-1`**, the only Region a CloudFront ACL can be made in, and it
  bills by the hour, so it parks with the environment: `resume` deploys it just before `App`, which reads its
  ARN when it deploys, and `park` destroys it after `App` (the distribution holds the ACL, and AWS WAF will not
  delete an ACL something still uses) and after the database stops. Its destroy is `--exclusively`, because
  `App` depends on it and `cdk destroy` would otherwise take `App` too.
- **The pipeline never deploys it.** A change to the rule is deployed by hand, before Deploy dev next runs if
  `App`'s reference changes with it, and otherwise whenever:

  ```bash
  cdk deploy Mvgl-dev-Waf --exclusively --profile mvgl-dev -c env=dev
  ```

  AWS resets a rate rule's counts when its settings change, and can pause it for up to a minute.
- **If dev is awake when a `Waf` stack first reaches `master`, deploy it by hand first**, with the command
  above, before the next Deploy dev run. That run's `App` deploy reads its output, and fails without it,
  keeping the release before.
- **A refused reader is told so, and never that we failed.** A page loaded while refused is the rule's own
  small HTML page; a page reached inside the site, or a write, shows the client's sentence for it,
  `RATE_LIMITED` in `@/lib/api`.
- **It counts before basic auth and before the cache.** While the door is on, a request without the pair is
  counted and then answered 401; a page served from the edge counts like any other.
- **An IPv6 address counts alone**, and an IPv6 connection usually has a whole /64 to move about in, so the
  rule holds the careless and the greedy, not the determined (ADR 0098 §5).
- **What it refused is logged** to `aws-waf-logs-mvgl-<env>-edge` in `us-east-1`, for two weeks or until the
  next park: blocked and counted requests only, with `Authorization`, `Cookie`, `Referer` and the query
  string redacted, because a search can be an email address. In CloudWatch Logs Insights, in `us-east-1`,
  on that group:

  ```text
  fields @timestamp, httpRequest.clientIp, httpRequest.uri, terminatingRuleId, action
  | filter action = "BLOCK"
  | stats count() by httpRequest.clientIp
  ```

  The addresses it is refusing now, the id being the last part of the `Waf` stack's `WebAclArn` output:

  ```bash
  aws wafv2 get-rate-based-statement-managed-keys --profile mvgl-dev --region us-east-1 --scope CLOUDFRONT --web-acl-name mvgl-dev-edge --web-acl-id <id> --rule-name requests-per-address
  ```
- **It costs about $6 a month awake**: $5 for the ACL and $1 for the rule, prorated by the hour, and $0.60 a
  million requests. Nothing parked.
- **No alarm yet.** WAF reports a CloudFront ACL's metrics in `us-east-1`, so an alarm on it needs a topic
  there, which is #434's.

**Proving it, on the resume after it first deploys.** `scripts/dev-check.mjs` with the profile signed in
checks that the distribution names the ACL, that the ACL holds the one rule and that it logs. Then a burst
from one address, best from AWS CloudShell so that your own address keeps browsing: it is refused for up to
five minutes after the burst stops. With a made-up pair, every answer is a 401 while the door is on (a 200
once it is off) until the rule trips, and a 429 after, which shows the rule and that it counts before the
door; the made-up pair also shows the log's redaction:

```bash
for i in $(seq 1 1000); do curl -s -o /dev/null -w "%{http_code}\n" -u nobody:nothing https://dev.myvideogamelist.net/robots.txt; done | uniq -c
```

Expect 401s for the first 300 or so, and for as many more as arrive while AWS catches up (it checks the rate
about every ten seconds, and says blocking usually starts within thirty), then 429s to the end.
`curl -si https://dev.myvideogamelist.net/` from the same address then shows the rule's page, with
`Retry-After: 60`. The log names
that address under `httpRequest.clientIp`, with `terminatingRuleId` `requests-per-address` and the
`authorization` header redacted: `xxx` by AWS's guide, `REDACTED` by its API reference, and this run says
which. After the next `park`, no web ACL is left:

```bash
aws wafv2 list-web-acls --scope CLOUDFRONT --region us-east-1 --profile mvgl-dev
```

## Alarms

Five alarms and a rule, emailed to the owner; what each watches and why its threshold is what it is
is ADR 0080. The alarms are in `App`, beside the balancer and the log group they read, so a parked
environment has none and a resume makes them again. What they send to is the `Alerts` stack: one
topic, `mvgl-<env>-alerts`, and one email subscription, kept apart because a person has to confirm
the subscription. The alarms name the topic rather than refer to it, so no `App` deploy waits on
`Alerts`, and nothing else does either.

| Name | Fires when |
|---|---|
| `mvgl-<env>-5xx-rate` | 5% of requests through the balancer, five at least, answered 5xx, in 2 of 3 five-minute windows |
| `mvgl-<env>-p99-latency` | the slowest 1% took 3 s or more to start answering, with 20 requests or more, for 3 windows running |
| `mvgl-<env>-unhealthy-target` | a target of either service failed its health checks, in any minute |
| `mvgl-<env>-db-connections` | 40 or more connections open on the database, for 3 windows running |
| `mvgl-<env>-igdb-failure-rate` | 10% of the API's calls to IGDB, three at least, failed, in 2 of 3 windows |
| `mvgl-<env>-task-stopped` (a rule) | a task of either service stopped on its own: its container exited, or it never started |

Every alarm also says when it is back to OK. **The address is never in the repository**, which is
public: it is a Parameter Store value the owner sets in the environment's account, which the stack
reads on every deploy.

**Once, before the first deploy that carries alarms**, in this order, from the repository root with
the `mvgl-dev` profile signed in. In Git Bash put `MSYS_NO_PATHCONV=1` in front of every command
naming a path that starts with `/`, or it is rewritten into a Windows path:

```bash
aws ssm put-parameter --profile mvgl-dev --name /mvgl/dev/alarm-email --type String --value "<address>"
```

```bash
cdk deploy Mvgl-dev-Alerts --profile mvgl-dev -c env=dev
```

Then click the link in the "AWS Notification - Subscription Confirmation" email, within two days.
The next `App` deploy - the pipeline's, or a resume - brings the alarms. Deployed before `Alerts`,
they would alarm into a topic that does not exist, and nobody would be told.

A new address is the same two commands, with `--overwrite` on the first, and a new confirmation.

**Proving it, after that `App` deploy.** Five alarms, each `OK` or `INSUFFICIENT_DATA`:

```bash
aws cloudwatch describe-alarms --profile mvgl-dev --alarm-name-prefix mvgl-dev- --query "MetricAlarms[].[AlarmName,StateValue]" --output table
```

An alarm's email, and the topic's policy for every alarm, since they publish alike: this sends
"ALARM: mvgl-dev-5xx-rate", and the next evaluation, within five minutes, sends it back to OK.

```bash
aws cloudwatch set-alarm-state --profile mvgl-dev --alarm-name mvgl-dev-5xx-rate --state-value ALARM --state-reason "Testing the alarm email"
```

The rule's path from ECS to the inbox: a stop whose reason begins `Alarm test` is the one stop by
hand it matches. The API is away for the minute its replacement takes.

```bash
aws ecs list-tasks --profile mvgl-dev --cluster mvgl-dev --service-name api --query "taskArns[0]" --output text
```

```bash
aws ecs stop-task --profile mvgl-dev --cluster mvgl-dev --task <task arn> --reason "Alarm test"
```

The IGDB alarm's two filters: their pattern, run over the API's log, finds its lines. Browse a page
or two first, so there is a call to find; `failed` in place of `succeeded` finds failures, if any.

```bash
aws logs filter-log-events --profile mvgl-dev --log-group-name /mvgl/dev/api --filter-pattern '{ ($.Category = "MyVideoGameList.Server.Observability.IgdbCalls") && ($.State.Outcome = "succeeded") }' --max-items 3 --query "events[].message"
```

And on the next release deployed after these: no task-stopped email and no `unhealthy-target`. A
deploy stops the old tasks by the scheduler's hand and starts the new targets as "initial", neither
of which should match, but AWS documents neither, so that release is the check.

## Parking and resuming

The balancer, not the containers, is what an idle environment pays for, so the lever that matters
is destroying the `App` stack; stopping the database afterwards reaches the idle floor
(ADR 0044). `node scripts/dev-env.mjs park` does both in that order, then destroys the web ACL's
stack, and gates the pipeline off; `resume` starts the database, migrates it at the newest pushed
tag, deploys the web ACL's stack and then `App` at that tag, checks the site through the
distribution and gates it back on; `status` says which cost row the
environment is on. Run Deploy dev first: parked, it builds master's images and stops, which makes
master's head the newest tag `resume` finds. The migrations are `resume`'s because that run skips
them along with the deploy: the newest tag can need migrations the database never had, and a failed
one stops the resume before anything is deployed. Run them
from the repository root with the `mvgl-dev` profile signed in. The `App` stack includes the
distribution, so a park and a resume each take several minutes longer than the services alone
would; a resume creates a new distribution with a new id, and nothing is cached across one.
`resume` proves the door is on - a 401 without credentials - and, with `MVGL_DEV_BASIC_AUTH` set
to the pair as `user:password`, that `/healthz` answers through it. Of a stack deployed open it
proves `/healthz` answers with no pair, and `status` says which the stack is.

`node scripts/dev-check.mjs` is the acceptance test, the walkthrough's Phase 11 as a program: run
it after any change to the stacks and after every resume. It asks the site whether it is behind
basic auth and, signed in to AWS, holds the answer against the `App` stack's `BasicAuth` output;
of an open site it runs everything below with no pair. Behind the door, without the pair it checks the door,
the three exempt paths and the redirect; with it, health, the crawler headers, `SITE_URL`, every
route's `Cache-Control`, where the cache hits and where it never may, that a 404 is a 404, and
that the write guard survives the edge. `--alb <dns name>` adds the check that the balancer does
not answer directly. With the `mvgl-dev` profile signed in it first asks AWS whether the web ACL is
on the distribution, and last whether the run itself stayed under half the rate rule's limit; it
sends 42 requests the rule counts with the pair.

## Things that will bite you

- **A migration that fails with `55P03`, "canceling statement due to lock timeout", is re-run.** The
  migration task waits five seconds for any lock and then gives up, because while its DDL waits every
  reader of that table waits behind it, and the old revision is still serving (ADR 0079). An export or
  a cache refresh in flight can cost one release that way. Failing twice means something holds a
  transaction open on the table it names: `pg_stat_activity` shows which session, and an API session
  idle in a transaction is ended within a minute anyway. The limit comes from
  `MyVideoGameList.Server/Data/SessionLimits.cs`, which `Infra.csproj` compiles from the API's source.

- **A stopped database may refuse to start, for a while.** A Single-AZ instance is pinned to its
  availability zone, and the small classes run out of capacity there now and then: the first
  resume of this environment was refused with `InsufficientDBInstanceCapacity`, and the same
  request succeeded a few minutes later. That is AWS's weather, not a mistake. `dev-env.mjs
  resume` asks again once a minute for up to twenty minutes; by hand, retry `start-db-instance`.
  If it persists, the way out is a different instance class in `DataStack`, not a different zone -
  a Single-AZ instance cannot be moved.

- **`cdk deploy` deploys a stack's dependencies too.** So `cdk deploy Mvgl-dev-App -c imageTag=…`
  on its own also redeploys `Data`, with whatever this checkout synthesises for it. Before
  CloudFront, when `Data` took an `allowedCidr` parameter, that silently replaced the balancer's
  allow rule with the prefix list and the site timed out from the one address that was allowed;
  the parameter is gone, but the habit stays: every deploy of `Migrate` or `App` uses
  `--exclusively` - `scripts/dev-env.mjs` and the pipeline both do - so the long-lived stack
  changes only when somebody deploys it by name.

- **Cross-stack references are weak, so `Data`'s outputs are only as complete as the synthesis
  that deployed it.** `cdk.json` sets `defaultCrossStackReferences` to `weak`: `Migrate` and `App`
  read what they need from `Data` at deployment time with `Fn::GetStackOutput`, and `Data` emits
  one output per thing they read - derived from the consumers present in the synthesis. Unlike an
  export, CloudFormation removes such an output without complaint while a deployed stack still
  reads it. The first Data redeploy after the first release was synthesised without an image tag,
  so the two stacks were not in the app, every one of those outputs was dropped with a clean log,
  and the next resume failed with "output … was not found". That is why `Program.cs` now puts the
  two stacks in every synthesis, carrying an error instead of an image when no tag is given, and
  why the deployed Migrate stack kept working throughout: a weak reference is resolved only when
  its own stack deploys. If the error ever returns, `cdk diff Mvgl-dev-Data` with any tag shows
  the outputs it would add back, and deploying it is the whole fix.

- **The subscription can go away without the stack knowing.** SNS deletes a subscription nobody
  confirmed within two days, and the unsubscribe link at the foot of every alarm's email removes it
  with one click. Either way CloudFormation still believes in it, so no deploy brings it back. The
  mend is to destroy `Alerts` and deploy it again - the alarms find the new topic by its name - and
  confirm again.

- **The IGDB alarm counts an Information line.** The API writes one line per IGDB call under the
  category `MyVideoGameList.Server.Observability.IgdbCalls` (ADR 0080), and the two metric filters in
  `Alarms.cs` match that category and the outcomes `succeeded` and `failed`. A log level above
  Information for that category, or a rename on either side, stops the count with a clean log and an
  alarm at OK through an outage. `IgdbCallLogTests` reads `Alarms.cs` and fails on the rename.

- **Every ingress rule on the balancer is owned by `DataStack`, and the listener is
  `Open = false`.** CDK otherwise "opens" an internet-facing balancer by writing `0.0.0.0/0`
  ingress for the listener port into its security group - which is the data stack's, so a synth
  that includes the application stack would silently undo the CloudFront-only rule the data stack
  holds, and the next `Data` deploy would apply it. Read the balancer group's inline
  `SecurityGroupIngress` in the synthesised Data template, not only the standalone ingress
  resources, when checking this.
