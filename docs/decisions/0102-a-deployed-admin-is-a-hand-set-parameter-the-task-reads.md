# 0102. A deployed environment's admin is a hand-set parameter the API's task reads as it starts

**Status:** Implemented; proved only by a deploy. Amends
[0042](0042-admins-are-named-in-configuration.md), which says a deployed admin is
`Admin__AccountIds__0` and not where a deployment gets it from.

## Context

0042 made an admin an account id in configuration: user secrets locally, and `Admin__AccountIds__0`
when deployed. Nothing deployed ever set that variable. The stacks pass the API no admin ids, so on dev
nobody could open `/admin`, and no command could change that without editing a task definition by hand,
which the next deploy would put back.

Two things about the value decide where it can live:

- **It does not exist until somebody has signed up.** An account id is made at registration, on the
  running site, so it cannot be known when the stacks are first deployed.
- **The repository is public.** An id is no secret, but it names one person's account, and it has no
  more business in a template than the alarm's email address has
  ([0080](0080-an-alarm-watches-what-a-reader-sees-and-mails-an-address-nobody-commits.md)).

## Decision

### 1. The id lives in Parameter Store, set by hand, and the task reads it as it starts

`/mvgl/<env>/admin-account-id`, a plain `String`. The API's container takes it as
`Admin__AccountIds__0` through the task definition's `secrets`, which name the parameter and not its
value.

Naming an admin is then two commands and no deploy: write the id, and restart the service. AWS's guide
to passing Parameter Store values to a container says the value is "injected into your container when
the container is initially started", that a running container "will not receive the updated value
automatically", and that a service is made to take it with "Force new deployment"
(<https://docs.aws.amazon.com/AmazonECS/latest/developerguide/secrets-envvar-ssm-paramstore.html>, read
on 2026-11-21).

**Not a value the stack reads at deploy time**, as the alarm's address is. That would put the id in the
task definition, and a change to it would wait for a deploy that has something else to change.

**Not a column or a role in the database.** 0042 settled that: the first admin still has to be put there
by some means, and the database has no public endpoint.

### 2. The parameter is nobody's stack's, and holds `none` until an account is named

No stack makes it. The App stack is destroyed by every park, and would take the parameter and the id in
it with it; the Data stack is deployed by hand, and a value there would mean a Data deploy before the
first release that read it.

So it is made by hand once per environment, before the first App deploy that reads it, holding `none`.
No account id is that word, so the admin policy matches nobody, which is what it did before.

### 3. A deploy without the parameter stops before it changes anything

The task definition holds the parameter's ARN, and CloudFormation does not look an ARN up. Left at
that, the first sign of a missing parameter would be a task that cannot start, minutes into a deploy:
a rollback on a running stack, and on a resume the whole stack rolled back.

So the App stack also declares a stack parameter of type `AWS::SSM::Parameter::Value<String>` naming
it, which nothing uses. CloudFormation fetches such a parameter as it builds the change set. Against
dev's running stack, before the parameter existed, the change set answered `Unable to fetch parameters
[/mvgl/dev/admin-account-id] from parameter store for this account` and nothing was changed.

`dev-env.mjs resume` asks for the parameter first as well, so that a resume says so before it has
waited for the database, migrated it and made the web ACL.

### 4. One admin

The variable is `Admin__AccountIds__0`, one id. A second admin is a second parameter and a second line
in the task definition. Nothing needs one yet.

## Consequences

- **A new environment has one more thing set by hand before its first App deploy**, beside the IGDB
  secret, the Turnstile pair, the basic-auth key and the alarm's address.
- **The id is visible to whoever can read the account's Parameter Store or its CloudFormation
  parameters**, where the resolved value of the unused parameter is shown. That is the account's
  owner.
- **The task's execution role may read that one parameter.**
- **Changing the admin restarts the API**, one task replaced by another with the service's usual
  rolling deployment.
