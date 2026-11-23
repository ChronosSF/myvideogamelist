/*
 * dev-check.mjs — the acceptance test for a deployed environment, through the distribution. Dev's
 * by default; production's with --env prod (ADR 0103).
 *
 * The walkthrough's Phase 11 list as a program, to run after any change to the stacks and after
 * every resume (ADR 0044, 0046). Everything is asked of the site the way a browser would ask it -
 * https://<env>.myvideogamelist.net, or the domain itself for production - so a pass means the whole
 * chain answered: CloudFront, the viewer-request function, the balancer's prefix-list rule and
 * origin-verify rule, and the two processes.
 *
 *   node scripts/dev-check.mjs [--env dev] [--game <igdb id>] [--alb <balancer dns name>] [--limiter]
 *                              [--profile mvgl-dev]
 *
 * Without MVGL_<ENV>_BASIC_AUTH (MVGL_DEV_BASIC_AUTH for dev) it checks only what needs no
 * credential: that the door is on, that the three exempt paths answer, that plain HTTP redirects,
 * that a name which only redirects does, and - with --alb - that the balancer
 * does not answer directly. With the pair as `user:password` it checks the rest: health, that both
 * processes answer the commit that was deployed, the crawler headers, SITE_URL, every route's
 * Cache-Control, that the cache hits where it should and never where it must not, that a 404 is a 404, and that the write guard survives the edge; with
 * --limiter, that the eleventh wrong password is a 429, at the cost of the caller's own login
 * budget for five minutes. Prints one line per check and exits 1 if any failed. Nothing here
 * writes anything anywhere: the one POST that reaches the API is a sign-out by nobody.
 *
 * A site deployed open (ADR 0101) asks nobody for the pair, so there the whole list runs without
 * it and the pair, if set, is never sent. Which the site is, it is asked: /healthz with no
 * credentials is a 401 behind basic auth and a 200 without. Whether that is what was meant is the
 * App stack's BasicAuth output, read when the profile is signed in, and a site that disagrees with
 * its stack fails the first check.
 *
 * With the environment's AWS profile signed in (--profile, mvgl-<env> by default), it first asks AWS,
 * read only, whether the edge's web ACL is on the distribution, holds its one rate rule and logs what
 * it refuses (ADR 0098), and which records the edge certificate is validated by, which it then asks
 * public DNS for: the certificate is renewed only while they are there (ADR 0103 §3). It also asks ECS
 * which image tag each service runs, and holds /version and /api/version to it (ADR 0059). Without the
 * profile those checks are skipped, and the run says so. Every request this script sends through the
 * distribution is counted, and when the rule's limit is known the last check
 * is that the run stayed under half of it, which leaves the rest for whoever runs it to browse with
 * from the same address. Behind basic auth a run sends 45 such requests with the pair, 56 with
 * --limiter, and 9 without; of an open site, 44, or 55 with --limiter. Production's is one more each
 * way, for www.
 */

import { resolveCname } from 'node:dns/promises';

import { runAws } from './aws-cli.mjs';
import { site } from './site.mjs';

const ARGS = process.argv.slice(2);
function option(name, fallback) {
    const i = ARGS.indexOf(name);
    return i >= 0 && ARGS[i + 1] !== undefined ? ARGS[i + 1] : fallback;
}

const ENV = option('--env', 'dev');
const PROFILE = option('--profile', `mvgl-${ENV}`);
// Where the environment answers, the names that only redirect there, and whether it is indexable.
const WHERE = site(ENV);
const HOST = WHERE.host;
const SITE = `https://${HOST}`;
const GAME = option('--game', '1942');
const ALB = option('--alb', null);
const PAIR = process.env[WHERE.basicAuthVariable];
// The pair as a header, where there is one. Set aside by `theDoorIs` on finding the site open, so that
// a credential nothing asks for is never sent to it.
let AUTH = PAIR ? { authorization: `Basic ${Buffer.from(PAIR).toString('base64')}` } : null;

let failed = 0;
let skipped = 0;
function report(ok, what, detail = '') {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
}

function skip(what, why) {
    skipped++;
    console.log(`skip ${what}: ${why}`);
}

/**
 * Requests sent through the distribution that the edge's rate rule counts: everything but /assets/, which
 * this script never asks for, and /__manifest (WafStack.UncountedPrefix and UncountedPath).
 */
let throughTheEdge = 0;

async function get(path, { auth = false, method = 'GET', headers = {}, payload = undefined, redirect = 'follow', base = SITE } = {}) {
    // By any of the distribution's names, over either scheme: the rule counts an address, not a name.
    const throughTheDistribution = [HOST, ...WHERE.redirectedHosts].includes(new URL(base).host);
    if (throughTheDistribution && !path.startsWith('/__manifest')) throughTheEdge++;
    const response = await fetch(`${base}${path}`, {
        method,
        redirect,
        headers: { ...(auth && AUTH ? AUTH : {}), ...headers },
        body: payload,
        signal: AbortSignal.timeout(45_000),
    });
    const body = await response.text();
    return { status: response.status, headers: response.headers, body };
}

const cache = (r) => r.headers.get('cache-control') ?? '(none)';
const xcache = (r) => (r.headers.get('x-cache') ?? '(none)').replace(' from cloudfront', '');
const stamp = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------------------------
// The edge's web ACL, asked of AWS rather than of the site (ADR 0098): a request it allows looks the
// same with it as without it. Read only, through the environment's profile.
// ---------------------------------------------------------------------------------------------

const EDGE_REGION = 'us-east-1';
const WAF_STACK = `Mvgl-${ENV}-Waf`;
const APP_STACK = `Mvgl-${ENV}-App`;
const WEB_ACL_LOG_GROUP = `aws-waf-logs-mvgl-${ENV}-edge`;

/** `aws` with the profile, its answer as JSON, or null when it failed or answered with anything else. */
function aws(args) {
    const r = runAws(PROFILE, args);
    return r.ok ? r.value : null;
}

function stackOutput(stack, key, region = []) {
    const outputs = aws(['cloudformation', 'describe-stacks', '--stack-name', stack, ...region, '--query', 'Stacks[0].Outputs']);
    return outputs?.find((o) => o.OutputKey === key)?.OutputValue ?? null;
}

/** The rule's limit and window when the ACL could be read, so the run can be held to it at the end. */
async function theFirewall(who) {
    if (!who.ok) {
        skip("the edge's web ACL", who.missing ? who.error : `the ${PROFILE} profile is not signed in (aws sso login --profile ${PROFILE})`);
        return null;
    }

    const arn = stackOutput(WAF_STACK, 'WebAclArn', ['--region', EDGE_REGION]);
    const distribution = stackOutput(APP_STACK, 'DistributionId');
    const named = distribution
        ? aws(['cloudfront', 'get-distribution-config', '--id', distribution, '--query', 'DistributionConfig.WebACLId'])
        : null;
    report(arn !== null && named === arn, `the distribution names ${WAF_STACK}'s web ACL`,
        arn === null ? `${WAF_STACK} has no WebAclArn output in ${EDGE_REGION}` : `${named || '(none)'}`);
    if (arn === null) return null;

    // arn:aws:wafv2:us-east-1:<account>:global/webacl/<name>/<id>
    const [, , name, id] = arn.split(':').at(-1).split('/');
    const acl = aws(['wafv2', 'get-web-acl', '--scope', 'CLOUDFRONT', '--region', EDGE_REGION, '--name', name, '--id', id])?.WebACL;
    const rule = acl?.Rules?.length === 1 ? acl.Rules[0] : null;
    const rate = rule?.Statement?.RateBasedStatement;
    const answer = rule?.Action?.Block?.CustomResponse?.ResponseCode;
    report(rate?.AggregateKeyType === 'IP' && answer === 429 && acl?.DefaultAction?.Allow !== undefined,
        'the web ACL allows everything but one rate rule, keyed on the address, that answers 429',
        rate ? `${rate.Limit} requests in ${rate.EvaluationWindowSec} s, answering ${answer}` : `${acl?.Rules?.length ?? 0} rules`);

    const logging = aws(['wafv2', 'get-logging-configuration', '--resource-arn', arn, '--region', EDGE_REGION])?.LoggingConfiguration;
    const redacted = (logging?.RedactedFields ?? [])
        .map((f) => (f.QueryString !== undefined ? 'query string' : f.SingleHeader?.Name?.toLowerCase()));
    report((logging?.LogDestinationConfigs ?? []).some((d) => d.endsWith(`:log-group:${WEB_ACL_LOG_GROUP}`))
        && ['authorization', 'cookie', 'referer', 'query string'].every((field) => redacted.includes(field)),
        `the web ACL logs what it refuses to ${WEB_ACL_LOG_GROUP}, with credentials, Referer and the query string redacted`,
        logging ? `${logging.LogDestinationConfigs.join(', ')}; redacted: ${redacted.join(', ') || 'nothing'}` : 'no logging configuration');

    return rate ? { limit: rate.Limit, window: rate.EvaluationWindowSec } : null;
}

// ---------------------------------------------------------------------------------------------
// The edge certificate's validation records, asked of public DNS, which is where ACM looks for them
// before it renews (ADR 0103 §3). Which records they are is ACM's to say, read only, through the
// environment's profile.
// ---------------------------------------------------------------------------------------------

const EDGE_CERT_STACK = `Mvgl-${ENV}-EdgeCert`;
const dnsName = (name) => name.toLowerCase().replace(/\.$/, '');

/** What a name is a CNAME for in public DNS: nothing, when it has no such record. */
async function cnames(name) {
    try {
        return (await resolveCname(dnsName(name))).map(dnsName);
    } catch (error) {
        if (error.code === 'ENOTFOUND' || error.code === 'ENODATA') return [];
        throw error;
    }
}

/**
 * The certificate CloudFront presents covers every name the distribution answers by, and each of its
 * validation records is still in public DNS. ACM renews a certificate only while they are, and looks
 * 45 days before it expires. Production's are the records the holding page's certificate was
 * validated by too, a record being made for a name and an account, and nothing AWS documents says
 * what becomes of them when that certificate is deleted. So it is asked, on the day and on every run
 * after.
 */
async function theCertificate(who) {
    if (!who.ok) {
        skip("the edge certificate's validation records", who.missing ? who.error : `the ${PROFILE} profile is not signed in (aws sso login --profile ${PROFILE})`);
        return;
    }

    const arn = stackOutput(EDGE_CERT_STACK, 'CertificateArn', ['--region', EDGE_REGION]);
    const certificate = arn
        ? aws(['acm', 'describe-certificate', '--region', EDGE_REGION, '--certificate-arn', arn, '--query', 'Certificate'])
        : null;
    const validations = certificate?.DomainValidationOptions ?? [];
    const names = [HOST, ...WHERE.redirectedHosts];
    report(certificate?.Status === 'ISSUED' && names.every((name) => validations.some((v) => v.DomainName === name)),
        `the edge certificate is issued, for ${names.join(' and ')}`,
        certificate
            ? `${certificate.Status}, for ${validations.map((v) => v.DomainName).join(', ') || 'no name'}`
            : `${EDGE_CERT_STACK} names no certificate that could be read in ${EDGE_REGION}`);

    for (const { DomainName: name, ResourceRecord: record } of validations) {
        if (!record) {
            report(false, `${name} is validated by a DNS record`, 'ACM names none for it');
            continue;
        }
        const found = await cnames(record.Name);
        report(found.includes(dnsName(record.Value)),
            `${name}'s validation record is in public DNS, which the certificate's renewal needs`,
            found.length > 0
                ? `${dnsName(record.Name)} is ${found.join(', ')}`
                : `${dnsName(record.Name)} has no CNAME: put it back (infra/README.md, "The first deploy")`);
    }
}

// ---------------------------------------------------------------------------------------------
// Without credentials.
// ---------------------------------------------------------------------------------------------

/**
 * Whether the site is behind basic auth, 'on' or 'off', by asking it: /healthz with no credentials is
 * a 401 with a Basic challenge behind the door and a 200 without it (ADR 0101). Where AWS can be asked,
 * the App stack's BasicAuth output says which was deployed, and the site has to agree: a door found
 * open that was meant shut is the failure this script most exists to catch. A stack from before that
 * output is 'on', as every deploy before it was.
 */
async function theDoorIs(signedIn) {
    const r = await get('/healthz');
    const found = r.status === 401 && /^Basic /.test(r.headers.get('www-authenticate') ?? '') ? 'on'
        : r.status === 200 ? 'off'
            : null;
    if (found === null) {
        report(false, '/healthz without credentials says whether the site is behind basic auth', `${r.status}, ${xcache(r)}`);
        return 'on';
    }
    if (signedIn) {
        const meant = stackOutput(APP_STACK, 'BasicAuth') === 'off' ? 'off' : 'on';
        report(found === meant, `basic auth at the edge is ${meant}, as ${APP_STACK} was deployed`, `found ${found}`);
    } else {
        skip(`whether basic auth is meant to be ${found}`, `found ${found}; ${APP_STACK} says which was deployed, and the ${PROFILE} profile is not signed in`);
    }
    if (found === 'off') AUTH = null;
    return found;
}

async function theDoor(door) {
    for (const path of ['/', '/healthz', '/lists']) {
        const r = await get(path);
        report(door === 'on'
            ? r.status === 401 && /^Basic /.test(r.headers.get('www-authenticate') ?? '')
            : r.status === 200,
        door === 'on' ? `${path} without credentials is a 401 with a Basic challenge` : `${path} answers anybody`,
        `${r.status}, ${xcache(r)}`);
    }
    // ADR 0044, D-8: fetched with credentials: 'omit', so exempt - and GET only.
    for (const tail of ['reviews', 'community-scores', 'community-times']) {
        const r = await get(`/api/games/${GAME}/${tail}`);
        report(r.status === 200, `/api/games/${GAME}/${tail} answers without credentials (D-8)`, `${r.status}`);
    }
    // Only a door has an exemption to check the edges of. On an open site this POST reaches the API.
    if (door === 'on') {
        const post = await get(`/api/games/${GAME}/reviews`, { method: 'POST', headers: { 'X-MVGL-Request': '1' } });
        report(post.status === 401 || post.status === 503, `POST to an exempt path is not exempt`, `${post.status}`);
    }

    const http = await get('/', { base: `http://${HOST}`, redirect: 'manual' });
    report(http.status === 301 && (http.headers.get('location') ?? '').startsWith(SITE),
        'plain HTTP is redirected to HTTPS', `${http.status} -> ${http.headers.get('location')}`);

    // A name that only redirects, production's www (ADR 0066 §2, 0103): the same path and query on the
    // host, by a 301, and before the door, so it needs no pair. A term of its own, so that the answer
    // is the function's and not one the edge kept.
    for (const name of WHERE.redirectedHosts) {
        const path = `/games?search=${stamp()}`;
        const r = await get(path, { base: `https://${name}`, redirect: 'manual' });
        report(r.status === 301 && r.headers.get('location') === `${SITE}${path}`,
            `${name} is redirected to the same address on ${HOST}`, `${r.status} -> ${r.headers.get('location')}`);
    }

    if (ALB) {
        // Only a timeout or a refused connection means the security group did its job. Any other
        // error - a certificate name mismatch, say, since the balancer's certificate is for the
        // site and not for its own name - means TCP and TLS both completed, which is the opposite.
        try {
            await fetch(`https://${ALB}/healthz`, { signal: AbortSignal.timeout(10_000) });
            report(false, 'the balancer does not answer directly', 'it answered');
        } catch (error) {
            const code = error.cause?.code ?? error.name;
            const unreachable = error.name === 'TimeoutError' || ['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ECONNREFUSED'].includes(code);
            report(unreachable, 'the balancer does not answer directly', unreachable ? code : `reachable: ${code}`);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// With the pair.
// ---------------------------------------------------------------------------------------------

async function health() {
    const live = await get('/healthz', { auth: true });
    report(live.status === 200 && live.body.trim() === 'Healthy', '/healthz is 200 Healthy', `${live.status} ${live.body.trim()}`);
    const ready = await get('/readyz', { auth: true });
    report(ready.status === 200, '/readyz is 200', `${ready.status} ${ready.body.trim()}`
        + (ready.body.trim() === 'Degraded' ? ' - still a 200 by design (ADR 0034), but here it means IGDB is unreachable or the secret is wrong' : ''));
}

const CLUSTER = `mvgl-${ENV}`;

/**
 * Which commit each process says it was built from (ADR 0059): the SSR server at /version and the API at
 * /api/version. Both have to name the same full commit, never `unknown`, which is an image built without
 * the deploy workflow's arguments. With the profile signed in, that commit also has to be the one ECS was
 * told to run: each service's task definition names its image by the tag the workflow pushed, the commit's
 * first twelve characters. Neither answer is kept at the edge (/api/* is never cached, and /version says
 * `private, no-store`), so what answers is what is running.
 */
async function deployedCommit(signedIn) {
    const answers = {};
    for (const path of ['/version', '/api/version']) {
        const r = await get(path, { auth: true });
        let sha = null;
        try {
            sha = JSON.parse(r.body)?.sha ?? null;
        } catch {
            // Not JSON: reported below by what it is not.
        }
        answers[path] = typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
        report(answers[path] !== null, `${path} names the full commit it was built from`, `${r.status}, ${sha ?? r.body.slice(0, 40)}`);
    }
    const [ssr, api] = [answers['/version'], answers['/api/version']];
    if (ssr === null || api === null) return;
    report(ssr === api, 'the SSR server and the API were built from one commit', ssr === api ? ssr.slice(0, 12) : `${ssr.slice(0, 12)} and ${api.slice(0, 12)}`);

    if (!signedIn) {
        skip('that the commit answering is the one deployed', `the ${PROFILE} profile is not signed in, and ECS says which tag each service runs`);
        return;
    }
    const definitions = aws(['ecs', 'describe-services', '--cluster', CLUSTER, '--services', 'api', 'ssr',
        '--query', 'services[].[serviceName,taskDefinition]']) ?? [];
    for (const [service, definition] of definitions) {
        const image = aws(['ecs', 'describe-task-definition', '--task-definition', definition,
            '--query', 'taskDefinition.containerDefinitions[0].image']);
        const tag = typeof image === 'string' ? image.split(':').at(-1) : null;
        const answered = service === 'api' ? api : ssr;
        report(tag !== null && answered.startsWith(tag), `the ${service} service runs the image tagged with the commit it answers`,
            `${tag ?? 'no image'}; ${service === 'api' ? '/api/version' : '/version'} says ${answered.slice(0, 12)}`);
    }
    if (definitions.length !== 2) report(false, 'ECS names a task definition for both services', `${definitions.length} found in ${CLUSTER}`);
}

async function crawlers() {
    // What a crawler is told is the environment's to decide (ADR 0036): production is indexable, so it
    // names its sitemap and sends no X-Robots-Tag of its own; anything else names none and says noindex,
    // nofollow on every response. Neither ever disallows a path.
    const robots = await get('/robots.txt', { auth: true });
    const disallowsSomething = /^Disallow:\s*\S/m.test(robots.body);
    const sitemapLine = /^Sitemap:\s*(\S+)/m.exec(robots.body)?.[1] ?? null;
    const robotsDetail = `${robots.status}${disallowsSomething ? ', disallows a path' : ''}, ${sitemapLine ? `Sitemap: ${sitemapLine}` : 'no Sitemap line'}`;
    const tag = robots.headers.get('x-robots-tag');
    if (WHERE.indexable) {
        report(robots.status === 200 && !disallowsSomething && sitemapLine === `${SITE}/sitemap.xml`,
            `/robots.txt is 200, disallows nothing and names ${SITE}/sitemap.xml`, robotsDetail);
        report(tag === null, 'SITE_INDEXABLE arrived: documents carry no X-Robots-Tag', tag ?? '(none)');
    } else {
        report(robots.status === 200 && !disallowsSomething && sitemapLine === null,
            '/robots.txt is 200, disallows nothing and names no sitemap', robotsDetail);
        report(tag === 'noindex, nofollow', 'documents carry X-Robots-Tag: noindex, nofollow', tag ?? '(none)');
    }
    const api = await get('/api/home', { auth: true });
    report(/noindex/.test(api.headers.get('x-robots-tag') ?? ''), 'API responses carry X-Robots-Tag: noindex', api.headers.get('x-robots-tag') ?? '(none)');
    const sitemap = await get('/sitemaps/pages.xml', { auth: true });
    const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    report(sitemap.status === 200 && locs.length > 0 && locs.every((l) => l.startsWith(SITE)),
        `SITE_URL arrived: every <loc> in /sitemaps/pages.xml begins ${SITE}`, `${sitemap.status}, ${locs.length} entries`);
}

async function cacheHeaders() {
    // ADR 0013's policies, read through CloudFront.
    const expected = {
        '/': 'public, max-age=0, s-maxage=300, stale-while-revalidate=600',
        '/games': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600',
        [`/games/${GAME}`]: 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
        '/lists': 'private, no-store',
        '/wishlist': 'private, no-store',
        '/user': 'private, no-store',
        '/news': 'private, no-store',
        '/import': 'private, no-store',
        '/admin': 'private, no-store',
        '/calendar': 'private, no-store',
    };
    for (const [path, policy] of Object.entries(expected)) {
        const r = await get(path, { auth: true });
        report(r.status === 200 && cache(r) === policy, `${path} says ${policy}`, `${r.status}, ${cache(r)}`);
    }
    const missing = await get(`/no-such-page-${stamp()}`, { auth: true });
    report(missing.status === 404 && /s-maxage=60\b/.test(cache(missing)), 'a 404 is a real 404 with s-maxage=60', `${missing.status}, ${cache(missing)}`);
}

async function cacheBehaviour() {
    // A term nobody has searched for is a Miss; the same term again is a Hit; a different term is
    // its own entry. That is the query string being in the cache key (0032's parameters).
    const term = stamp();
    const first = await get(`/games?search=${term}`, { auth: true });
    const second = await get(`/games?search=${term}`, { auth: true });
    const other = await get(`/games?search=${stamp()}`, { auth: true });
    report(xcache(first) === 'Miss' && xcache(second) === 'Hit', '/games?search= is cached, keyed by the search',
        `${xcache(first)}, then ${xcache(second)}`);
    report(xcache(other) === 'Miss', 'a different ?search= is a different entry', xcache(other));

    // A parameter missing from the policy's allowlist is not merely shared between values: it never
    // reaches the origin, so the page renders as though nothing had been chosen. A fresh term under one
    // rating renders with that rating selected, and the same term under another is its own entry
    // (0067's `esrb`, the newest name on the list).
    const rated = stamp();
    const mature = await get(`/games?search=${rated}&esrb=m`, { auth: true });
    const teen = await get(`/games?search=${rated}&esrb=t`, { auth: true });
    report(/<option value="m" selected=""/.test(mature.body) && xcache(teen) === 'Miss',
        '?esrb= reaches the origin and is in the cache key', `${xcache(mature)}, then ${xcache(teen)} under another rating`);

    // The home page is kept twice, by the signed-in flag alone (ADR 0074). The two bodies differing is
    // what says the behaviour for `/` matched at all: the default keys on no cookie and forwards none,
    // so it would answer both with the welcome.
    const flag = { cookie: 'mvgl_signed_in=1' };
    const welcome = await get('/', { auth: true });
    const flagged = await get('/', { auth: true, headers: flag });
    const flaggedAgain = await get('/', { auth: true, headers: flag });
    report(/Create an account/.test(welcome.body) && /Welcome back/.test(flagged.body) && !/Create an account/.test(flagged.body),
        '/ draws the welcome without the signed-in flag, and the signed-in top section with it',
        `${welcome.status} and ${flagged.status}`);
    report(/^(Hit|RefreshHit)$/.test(xcache(flaggedAgain)), 'the flagged copy of / is served from the edge on the second request',
        `${xcache(flagged)}, then ${xcache(flaggedAgain)}; ${cache(flaggedAgain)}`);

    // Its .data too, which a navigation to the home page asks for: on the default behaviour it would be the
    // same answer either way, and a navigation made before auth answers would draw the welcome.
    const visitorData = await get('/_.data', { auth: true });
    const flaggedData = await get('/_.data', { auth: true, headers: flag });
    report(visitorData.status === 200 && flaggedData.status === 200 && visitorData.body !== flaggedData.body,
        '/_.data is keyed on the signed-in flag as / is', `${visitorData.status} and ${flaggedData.status}`);

    // React Router's lazy route discovery: a navigation to a route the page has not seen asks
    // `/__manifest` for it, by `paths` and the build's `version`. With either kept from the origin it
    // answers 204, and the page reloads once, then fails the next navigation with "Something went
    // wrong". The version is the one the home page was rendered with.
    const version = /__reactRouterManifest\s*=\s*\{[\s\S]*?"version":\s*"([^"]+)"/.exec(welcome.body)?.[1];
    const discovered = version
        ? await get(`/__manifest?paths=${encodeURIComponent('/games')}&version=${encodeURIComponent(version)}`, { auth: true })
        : null;
    report(discovered?.status === 200 && /^\{".+/.test(discovered.body),
        'route discovery (/__manifest) answers the routes asked for, by paths and version',
        version ? `${discovered.status}, ${discovered.body.slice(0, 40)}` : 'no manifest version in the home page');

    const page = await get(`/games/${GAME}`, { auth: true });
    const again = await get(`/games/${GAME}`, { auth: true });
    report(/^(Hit|RefreshHit)$/.test(xcache(again)), `/games/${GAME} is served from the edge on the second request`, `${xcache(page)}, then ${xcache(again)}`);

    for (const path of ['/lists', '/user']) {
        const a = await get(path, { auth: true });
        const b = await get(path, { auth: true });
        report(xcache(a) !== 'Hit' && xcache(b) !== 'Hit', `${path} is never a Hit`, `${xcache(a)}, then ${xcache(b)}`);
    }
}

/**
 * Opt-in, because it spends the caller's own login budget for five minutes: ten wrong passwords
 * for an account that does not exist are 401s, and the eleventh is a 429 from the limiter behind
 * the edge. What this cannot show from outside is *which* address the limiter partitioned on -
 * the viewer's, as D-7 intends, or the edge's - because the API logs nothing about the address;
 * it shows that the limiter is on and that one caller's attempts land in one bucket.
 */
async function limiter() {
    const email = `nobody-${stamp()}@test.local`;
    const attempt = () => get('/api/auth/login', {
        auth: true,
        method: 'POST',
        headers: { 'X-MVGL-Request': '1', 'content-type': 'application/json' },
        payload: JSON.stringify({ email, password: 'not-the-password' }),
    });
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt()).status);
    report(statuses.slice(0, 10).every((s) => s === 401) && statuses[10] === 429,
        'the eleventh wrong password in five minutes is a 429', statuses.join(' '));
}

async function writeGuard() {
    // ADR 0033: no header is a 403 from the guard; the header and nobody signed in is a 401. A 403
    // on the second means CloudFront stripped X-MVGL-Request, which /api/*'s AllViewer must not.
    const bare = await get('/api/auth/logout', { auth: true, method: 'POST' });
    report(bare.status === 403, 'a write without X-MVGL-Request is refused with 403', `${bare.status}`);
    const marked = await get('/api/auth/logout', { auth: true, method: 'POST', headers: { 'X-MVGL-Request': '1' } });
    report(marked.status === 401, 'a write with X-MVGL-Request reaches the API (401: nobody signed in)', `${marked.status}`);
}

console.log(`Checking ${SITE}`);
// Whether AWS can be asked at all, once, for the web ACL, the edge certificate and what the App stack
// was deployed as.
const who = runAws(PROFILE, ['sts', 'get-caller-identity']);
// Apart from the site's own checks, so that nothing AWS answers can keep them from running.
let rule = null;
try {
    rule = await theFirewall(who);
} catch (error) {
    report(false, "the edge's web ACL could be read", error.message);
}
try {
    await theCertificate(who);
} catch (error) {
    report(false, "the edge certificate's validation records could be asked for", error.code ?? error.message);
}
try {
    const door = await theDoorIs(who.ok);
    if (door === 'on' && !AUTH) console.log(`  (behind basic auth, and no ${WHERE.basicAuthVariable}: credential-free checks only)`);
    await theDoor(door);
    if (door === 'off' || AUTH) {
        await health();
        await deployedCommit(who.ok);
        await crawlers();
        await cacheHeaders();
        await cacheBehaviour();
        await writeGuard();
        if (ARGS.includes('--limiter')) await limiter();
    }
} catch (error) {
    report(false, 'a request failed outright', error.cause?.code ?? error.message);
}
// The acceptance test must never be what trips the rule it checks, nor leave the person running it
// too little of the limit to browse with from the same address.
if (rule) {
    report(throughTheEdge <= rule.limit / 2, 'this run stayed under half the rate rule\'s limit',
        `${throughTheEdge} requests through the distribution, against ${rule.limit} in ${rule.window} s`);
}
const skips = skipped === 0 ? '' : ` ${skipped} skipped.`;
console.log(failed === 0 ? `\nAll checks passed.${skips}` : `\n${failed} check(s) failed.${skips}`);
process.exit(failed === 0 ? 0 : 1);
