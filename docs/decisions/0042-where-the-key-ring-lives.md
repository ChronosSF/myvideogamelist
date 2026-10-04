# 0042. The key ring lives in Parameter Store, under a name that does not move, and never nowhere by accident

**Status:** Implemented in the code; proved only by a deploy. Settles the Data Protection key store
that [0007](0007-aws-target-architecture.md) named as "S3 or DynamoDB with a KMS key" and
[0015](0015-fargate-confirmed-and-nat-less-networking.md) carried forward unchanged. The deployment
guide's D-3 is this record.

## Context

ASP.NET Core's Data Protection key ring is what signs the Identity cookie, and since
[0028](0028-a-games-community-view.md) it also seals the review cursor. Until now `Program.cs`
never configured it, so each process made its own ring and kept it wherever the default put it: in
the user profile on a developer machine, which persists, and on the container's own filesystem in
an image, which does not. On Fargate that means every deploy starts with a fresh ring and signs
every user out, and two tasks of the same service cannot read each other's cookies. The failure is
silent — the log is clean, and what a user sees is "please sign in again".

0007 said this had to be fixed before the first multi-task deploy and named S3 or DynamoDB with a
KMS key. Checking for the deployment guide found no maintained package for either: the community
`AspNetCore.DataProtection.Aws.S3` stopped at 2.2.0 and its repository was archived in 2022, with a
README that sends readers to AWS's own Systems Manager provider. So the real choice was between two
stores, neither the one 0007 wrote down.

## Decision

**The ring is persisted to Systems Manager Parameter Store**, through
`Amazon.AspNetCore.DataProtection.SSM` (4.0.3, owned by AWS, targets net10.0). Each key becomes one
`SecureString` parameter under a path that configuration names — `DataProtection:ParameterPath`,
`/mvgl/dev/data-protection` for dev and a different path for every other environment. A
`SecureString` is always encrypted by KMS; with no key named, under the account's AWS-managed
`aws/ssm` key, which costs nothing. Standard parameters cost nothing either, and a Data Protection
key is around a kilobyte against the standard tier's four-kilobyte cap.

**Every payload is bound to `SetApplicationName("MyVideoGameList")`.** Without that call the
discriminator is derived from the content root path, so moving the application inside its image —
`/app` to `/srv`, say — would orphan every cookie and every cursor ever issued while the keys
themselves stayed perfectly readable. A name is a thing we choose; a path is a thing a Dockerfile
chooses.

**Where the ring is persisted is decided by configuration, and the dangerous case is refused.**
`AddDataProtectionKeys` reads one section:

| Environment | `ParameterPath` | Result |
|---|---|---|
| any | set | persisted to Parameter Store under that path |
| Development | empty | the default ring in the user profile, which is right for one process on one machine |
| anything else | empty | **startup failure**, naming the setting |
| anything else | empty, `AllowEphemeralKeys: true` | the default ring, by stated decision |

The last row exists for one purpose: running the production image on a developer machine, which
the deployment guide's Phase 4 does to prove the image starts. A deployment that sets it has chosen
to sign everyone out on every deploy, and has had to say so. This is the same shape as
`ForwardedHeaders` in [0033](0033-what-the-api-refuses.md): the misconfiguration that fails
silently is turned into one that fails at startup, and the one legitimate exception is spelled
out rather than inferred.

**Nothing about AWS is configured in the application.** The package registers a Systems Manager
client through `AWSSDK.Extensions.NETCore.Setup`, which takes the region from `AWS_REGION` — set
by the ECS agent — and credentials from the task role. Locally the client is never constructed,
because the path is empty.

## Alternatives rejected

- **The application database**, through Microsoft's
  `Microsoft.AspNetCore.DataProtection.EntityFrameworkCore`. One migration, no AWS coupling,
  identical locally and deployed, and the keys travel with every restore. Rejected because the
  keys that can mint any session would then sit in the database they protect, and Microsoft's
  documentation is explicit that naming a persistence location turns off encryption at rest. On
  Linux there is no DPAPI, so protecting them means `ProtectKeysWithCertificate`, and the
  certificate then needs a home outside the database — the original problem again. RDS storage
  encryption covers the volume; it does not cover a dump, or a developer's copy of one. The one
  argument for it was keeping the AWS SDK out of the API, and the plan removes that argument
  within two issues: CloudFront invalidation (D14, #99) and SES (#100) both put one there.
- **S3 or DynamoDB, as 0007 words it.** No maintained package; a hand-written `IXmlRepository`
  with its own tests, for no advantage over a store AWS maintains a provider for.
- **A customer-managed KMS key.** A dollar a month and `kms:Encrypt`/`kms:Decrypt` on the task
  role, for a key whose only consumer is this ring. The AWS-managed key is enough until something
  else in the account needs a key policy of its own.
- **Failing at startup when the store is unreachable.** The repository is constructed when
  `KeyManagementOptions` is first resolved, which is the first protect or unprotect, not the boot.
  Forcing a read at startup would make a Parameter Store blip a failed deploy rather than a failed
  sign-in, and the health check that exists for this — a session surviving a redeploy — is a
  better proof than a probe. Recorded here so that nobody adds the probe expecting it to be free.

## Consequences

- **The task role needs `ssm:GetParametersByPath`, `ssm:PutParameter` and `ssm:DeleteParameter`
  on the path**, the last because on .NET 9 and later the package's repository is deletable. A
  policy missing one of them fails the first sign-in after a deploy, not the deploy — see above —
  so the first thing to do after step 7.8 of the guide is to sign in, redeploy, and reload.
- **One path per environment, and the paths must differ.** Dev and prod reading the same ring
  would make a dev cookie valid in prod. The path is the environment boundary, and it is set in
  the task definition, not in an `appsettings` file.
- **Keys are rotated by Data Protection, every ninety days, and never deleted by us.** The package
  supports deletion; nothing here calls it. A key that is expired is still needed to read what it
  sealed until the last thirty-day cookie issued under it has gone, and the parameters cost
  nothing to keep.
- **`AllowEphemeralKeys` is for a developer machine.** It appears in no task definition. If it
  ever has to, that is a decision to write down, not a flag to flip.
- **The default ring on a developer machine is shared by every checkout and every worktree**,
  since it is keyed by the user profile and now by one application name. That is harmless —
  it is one person's machine — and it means a cookie issued by one branch is readable by another.
- **Local Development still never calls AWS.** `dotnet run` with an empty path registers no
  client, so a machine with no AWS profile behaves as it did before this record.
- **This departs from the letter of 0007**, whose status line now points here. The intent —
  KMS-backed, outside the database, shared by every task — is kept.
