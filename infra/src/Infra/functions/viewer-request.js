// The site's viewer request, on every behaviour of the distribution that has a use for it (ADR 0044,
// 0101, 0103). CloudFront Functions, JavaScript runtime 2.0. A behaviour holds one function for each
// event, so its two jobs are one function, in this order:
//
// 1. One host is canonical, so any other name the request arrived by - production's www, or the
//    distribution's own cloudfront.net domain - is answered with a permanent redirect to the same path
//    and query on the host. Browsers keep a 301 for good, and the holding page sent www to the apex
//    before production did, which is why production has to go on doing it (ADR 0066 §2).
// 2. Where the environment is behind it, the door: HTTP basic authentication. The expected value -
//    `Basic <base64 of user:password>` - lives in the KeyValueStore DataStack creates, under the key
//    `basic-auth`, and is set by hand; it is never in this repository or in a template.
//
// The redirect comes first, so that a name that only redirects never asks for the pair.
//
// Nothing about the environment is written here. Edge.cs puts each value in place of its token below
// when it reads this file: the host from Site.Host, which the certificate and the records are made
// for, whether the door is on from Site.BehindBasicAuth, and the environment's name.
import cf from 'cloudfront';

const CANONICAL_HOST = '__CANONICAL_HOST__';
const BEHIND_BASIC_AUTH = '__BASIC_AUTH__' === 'on';
const REALM = 'MVGL __ENV__';

const kvs = cf.kvs();

// Three paths the client fetches with `credentials: 'omit'`, so that the sign-in cookie cannot reach
// endpoints that answer everybody alike (ADR 0028). HTTP authentication counts as a credential too,
// so the browser withholds the Authorization header from exactly those requests, and behind basic
// auth every game page's community section would be empty. Read-only, public by design, and nothing
// the open site does not show (ADR 0044, D-8).
const OPEN = /^\/api\/games\/\d+\/(reviews|community-scores|community-times)$/;

async function handler(event) {
    const request = event.request;
    const host = request.headers.host ? request.headers.host.value : '';

    if (host !== CANONICAL_HOST) {
        // The path and the query exactly as they were sent: rawQueryString() is runtime 2.0's
        // unparsed query, without its '?', and undefined when there was none. A path that does not
        // start with a slash cannot happen in HTTP, and would otherwise make the address after the
        // host a user name - https://myvideogamelist.net@elsewhere/ - so it becomes the root.
        const path = request.uri.charAt(0) === '/' ? request.uri : '/';
        const query = request.rawQueryString();

        return {
            statusCode: 301,
            statusDescription: 'Moved Permanently',
            headers: {
                location: { value: 'https://' + CANONICAL_HOST + path + (query ? '?' + query : '') },
            },
        };
    }

    if (!BEHIND_BASIC_AUTH) {
        return request;
    }

    if (request.method === 'GET' && OPEN.test(request.uri)) {
        return request;
    }

    // Throws when the key is not set, and a function that throws is an error response from
    // CloudFront: the door fails closed, never open.
    const expected = await kvs.get('basic-auth');
    const sent = request.headers.authorization;

    if (sent && sent.value === expected) {
        return request;
    }

    return {
        statusCode: 401,
        statusDescription: 'Unauthorized',
        headers: { 'www-authenticate': { value: 'Basic realm="' + REALM + '"' } },
    };
}
