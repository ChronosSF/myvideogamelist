/**
 * Catch-all route. Throwing here hands rendering to the root ErrorBoundary,
 * which already knows how to present a 404, and returns a real 404 status to
 * crawlers rather than a 200 with an empty page.
 */
export async function loader() {
    throw new Response('Not Found', { status: 404, statusText: 'Not Found' });
}

export default function NotFoundPage() {
    return null;
}
