import { CACHE_ROBOTS } from '@/lib/cache';
import { resourceResponse, robotsTxt, siteConfig } from '@/lib/seo';

/**
 * `/robots.txt`.
 *
 * A route rather than a file in `public/`, because what it says depends on which deployment is
 * answering, and one build is deployed to more than one. It makes no upstream call, which also
 * makes it the cheapest honest answer to "is this process serving requests".
 */
export function loader() {
    return resourceResponse(robotsTxt(siteConfig()), 'text/plain; charset=utf-8', CACHE_ROBOTS);
}
