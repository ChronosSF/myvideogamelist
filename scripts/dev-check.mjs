/*
 * dev-check.mjs — the acceptance test for the dev environment, through the distribution.
 *
 * The walkthrough's Phase 11 list as a program, to run after any change to the stacks and after
 * every resume (ADR 0044, 0046). Everything is asked of https://<env>.myvideogamelist.net the way a
 * browser would ask it, so a pass means the whole chain answered: CloudFront, the basic-auth
 * function, the balancer's prefix-list rule and origin-verify rule, and the two processes.
 *
 *   node scripts/dev-check.mjs [--env dev] [--game <igdb id>] [--alb <balancer dns name>] [--limiter]
 *
 * Without MVGL_DEV_BASIC_AUTH it checks only what needs no credential: that the door is on, that
 * the three exempt paths answer, that plain HTTP redirects, and - with --alb - that the balancer
 * does not answer directly. With the pair as `user:password` it checks the rest: health, the
 * crawler headers, SITE_URL, every route's Cache-Control, that the cache hits where it should and
 * never where it must not, that a 404 is a 404, and that the write guard survives the edge; with
 * --limiter, that the eleventh wrong password is a 429, at the cost of the caller's own login
 * budget for five minutes. Prints one line per check and exits 1 if any failed. Nothing here
 * writes anything anywhere: the one POST that reaches the API is a sign-out by nobody.
 */

const ARGS = process.argv.slice(2);
function option(name, fallback) {
    const i = ARGS.indexOf(name);
    return i >= 0 && ARGS[i + 1] !== undefined ? ARGS[i + 1] : fallback;
}

const ENV = option('--env', 'dev');
const HOST = `${ENV}.myvideogamelist.net`;
const SITE = `https://${HOST}`;
const GAME = option('--game', '1942');
const ALB = option('--alb', null);
const PAIR = process.env.MVGL_DEV_BASIC_AUTH;
const AUTH = PAIR ? { authorization: `Basic ${Buffer.from(PAIR).toString('base64')}` } : null;

let failed = 0;
function report(ok, what, detail = '') {
    if (!ok) failed++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `: ${detail}` : ''}`);
}

async function get(path, { auth = false, method = 'GET', headers = {}, payload = undefined, redirect = 'follow', base = SITE } = {}) {
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
// Without credentials.
// ---------------------------------------------------------------------------------------------

async function theDoor() {
    for (const path of ['/', '/healthz', '/lists']) {
        const r = await get(path);
        report(r.status === 401 && /^Basic /.test(r.headers.get('www-authenticate') ?? ''),
            `${path} without credentials is a 401 with a Basic challenge`, `${r.status}, ${xcache(r)}`);
    }
    // ADR 0044, D-8: fetched with credentials: 'omit', so exempt - and GET only.
    for (const tail of ['reviews', 'community-scores', 'community-times']) {
        const r = await get(`/api/games/${GAME}/${tail}`);
        report(r.status === 200, `/api/games/${GAME}/${tail} answers without credentials (D-8)`, `${r.status}`);
    }
    const post = await get(`/api/games/${GAME}/reviews`, { method: 'POST', headers: { 'X-MVGL-Request': '1' } });
    report(post.status === 401 || post.status === 503, `POST to an exempt path is not exempt`, `${post.status}`);

    const http = await get('/', { base: `http://${HOST}`, redirect: 'manual' });
    report(http.status === 301 && (http.headers.get('location') ?? '').startsWith(SITE),
        'plain HTTP is redirected to HTTPS', `${http.status} -> ${http.headers.get('location')}`);

    if (ALB) {
        try {
            await fetch(`https://${ALB}/healthz`, { signal: AbortSignal.timeout(10_000) });
            report(false, 'the balancer does not answer directly', 'it answered');
        } catch (error) {
            report(true, 'the balancer does not answer directly', error.cause?.code ?? error.name);
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

async function crawlers() {
    const robots = await get('/robots.txt', { auth: true });
    const disallowsSomething = /^Disallow:\s*\S/m.test(robots.body);
    const namesSitemap = /^Sitemap:/m.test(robots.body);
    report(robots.status === 200 && !disallowsSomething && !namesSitemap,
        '/robots.txt is 200, disallows nothing and names no sitemap', `${robots.status}${disallowsSomething ? ', disallows a path' : ''}${namesSitemap ? ', has a Sitemap line' : ''}`);
    report(robots.headers.get('x-robots-tag') === 'noindex, nofollow',
        'documents carry X-Robots-Tag: noindex, nofollow', robots.headers.get('x-robots-tag') ?? '(none)');
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

console.log(`Checking ${SITE}${AUTH ? '' : ' (no MVGL_DEV_BASIC_AUTH: credential-free checks only)'}`);
try {
    await theDoor();
    if (AUTH) {
        await health();
        await crawlers();
        await cacheHeaders();
        await cacheBehaviour();
        await writeGuard();
        if (ARGS.includes('--limiter')) await limiter();
    }
} catch (error) {
    report(false, 'a request failed outright', error.cause?.code ?? error.message);
}
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
