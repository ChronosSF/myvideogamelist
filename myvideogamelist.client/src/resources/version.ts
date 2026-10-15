import { PRIVATE_NO_STORE } from '@/lib/cache';
import { resourceResponse } from '@/lib/seo';

/** What either value is wherever the build did not say: a developer's machine, or a bare build. */
const UNKNOWN = 'unknown';

/**
 * `/version` — which commit this server was built from, and when its image was built.
 *
 * The same shape as the API's `/api/version`, so "which commit is live" is one request to each and
 * the two answers can be compared field by field. The values are the image's `BUILD_SHA` and
 * `BUILD_TIME`, which the client Dockerfile sets from its `GIT_SHA` and `BUILD_TIME` build
 * arguments and the deploy workflow fills from the commit it built. Nothing is asked of the API, so
 * this answers whenever the process does. See ADR 0059.
 */
export function loader() {
    const version = {
        sha: process.env.BUILD_SHA?.trim() || UNKNOWN,
        builtAt: process.env.BUILD_TIME?.trim() || UNKNOWN,
    };

    // Never cached: a stored answer to "what is running now" is wrong from the next deploy on.
    const response = resourceResponse(JSON.stringify(version), 'application/json; charset=utf-8', PRIVATE_NO_STORE);

    // Not a page anybody should find in a search, on a deployment that is indexed as well.
    if (!response.headers.has('X-Robots-Tag')) response.headers.set('X-Robots-Tag', 'noindex');

    return response;
}
