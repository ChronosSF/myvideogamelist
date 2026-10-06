// The dev site's door: HTTP basic authentication at the edge, on every behaviour (ADR 0036, 0044).
// CloudFront Functions, JavaScript runtime 2.0. The expected value - `Basic <base64 of user:password>` -
// lives in the KeyValueStore DataStack creates, under the key `basic-auth`, and is set by hand; it is
// never in this repository or in a template.
import cf from 'cloudfront';

const kvs = cf.kvs();

// Three paths the client fetches with `credentials: 'omit'`, so that the sign-in cookie cannot reach
// endpoints that answer everybody alike (ADR 0028). HTTP authentication counts as a credential too,
// so the browser withholds the Authorization header from exactly those requests, and behind basic
// auth every game page's community section would be empty. Read-only, public by design, and nothing
// the production site will not show (ADR 0044, D-8).
const OPEN = /^\/api\/games\/\d+\/(reviews|community-scores|community-times)$/;

async function handler(event) {
    const request = event.request;

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
        headers: { 'www-authenticate': { value: 'Basic realm="MVGL dev"' } },
    };
}
