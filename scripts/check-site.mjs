/*
 * check-site.mjs — that site.mjs still says what infra/src/Infra/Site.cs decides.
 *
 *   node scripts/check-site.mjs <env> [<cdk.out>]
 *
 * site.mjs restates three members of Site.cs for dev-env.mjs and dev-check.mjs, and the acceptance
 * test expects of a site what it says: the names that redirect, and whether a crawler may index it.
 * A change to Site.cs that missed it would leave that test checking the old rules. So this compares
 * it with what the CDK app synthesised for the environment, which is Site.cs at work: the names on
 * the distribution and on the certificate, where the App stack says the site answers, and whether
 * the SSR server is told it is indexable.
 *
 * CI's Infrastructure job runs it after each synthesis. By hand, synthesise first, from infra/:
 * `cdk synth -c env=<env> -c imageTag=<any>`. It reads files and asks nothing of anybody.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { site } from './site.mjs';

const [env, out] = process.argv.slice(2);
if (!env) {
    console.error('usage: node scripts/check-site.mjs <env> [<cdk.out>]');
    process.exit(2);
}
const dir = resolve(out ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'infra', 'cdk.out'));
const where = site(env);

function template(stack) {
    const path = join(dir, `Mvgl-${env}-${stack}.template.json`);
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    } catch (error) {
        console.error(`${path} could not be read (${error.code ?? error.message}). Synthesise ${env} first.`);
        process.exit(2);
    }
}

/** The properties of every resource of a type in a template. */
const resources = (from, type) => Object.values(from.Resources ?? {}).filter((r) => r.Type === type).map((r) => r.Properties);

let failed = 0;
function same(what, synthesised, restated) {
    const [a, b] = [JSON.stringify(synthesised), JSON.stringify(restated)];
    if (a !== b) failed++;
    console.log(a === b ? `ok   ${what}: ${a}` : `FAIL ${what}: synthesised ${a}, and site.mjs says ${b}`);
}

const app = template('App');
const certificate = template('EdgeCert');
const names = [where.host, ...where.redirectedHosts];

console.log(`scripts/site.mjs against what was synthesised for ${env}, in ${dir}`);
same("the distribution's names",
    resources(app, 'AWS::CloudFront::Distribution').map((d) => d.DistributionConfig.Aliases ?? []), [names]);
same("the certificate's names",
    resources(certificate, 'AWS::CertificateManager::Certificate').map((c) => [c.DomainName, ...(c.SubjectAlternativeNames ?? [])]), [names]);
same('where the App stack says the site answers', app.Outputs?.SiteUrl?.Value, `https://${where.host}`);
same('whether the SSR server is told the site is indexable',
    resources(app, 'AWS::ECS::TaskDefinition')
        .flatMap((task) => task.ContainerDefinitions ?? [])
        .some((container) => (container.Environment ?? []).some((e) => e.Name === 'SITE_INDEXABLE' && e.Value === 'true')),
    where.indexable);

if (failed > 0) {
    console.log(`\n${failed} difference(s). infra/src/Infra/Site.cs decides each of these, and scripts/site.mjs restates it: change it there.`);
    process.exit(1);
}
console.log('\nscripts/site.mjs agrees with Site.cs.');
