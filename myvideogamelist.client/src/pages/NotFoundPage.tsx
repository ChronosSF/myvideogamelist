import { CACHE_NOT_FOUND } from '@/lib/cache';

/**
 * Catch-all route. Throwing here hands rendering to the root ErrorBoundary,
 * which already knows how to present a 404, and returns a real 404 status to
 * crawlers rather than a 200 with an empty page.
 *
 * The cache header goes on the thrown Response rather than in a `headers` export: a thrown
 * Response short-circuits the route's own headers and carries its own.
 */
export async function loader() {
    throw new Response('Not Found', {
        status: 404,
        statusText: 'Not Found',
        headers: { 'Cache-Control': CACHE_NOT_FOUND },
    });
}

export default function NotFoundPage() {
    return null;
}
