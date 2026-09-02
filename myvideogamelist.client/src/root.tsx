import {
    Links,
    Meta,
    Outlet,
    Scripts,
    ScrollRestoration,
    isRouteErrorResponse,
    type LinksFunction,
} from 'react-router';
import type { Route } from './+types/root';
import { AuthProvider } from '@/contexts/AuthProvider';
import { ListsProvider } from '@/contexts/ListsProvider';
import { WishlistProvider } from '@/contexts/WishlistProvider';
import { Navbar } from '@/components/Navbar';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import './index.css';
import './App.css';

export function meta() {
    return [
        { title: 'MyVideoGameList - Track every game you play' },
        {
            name: 'description',
            content: 'Track the games you have played, build a backlog and wishlist, '
                + 'and see what is releasing next across every platform.',
        },
    ];
}

/**
 * The default cache policy, and the one that governs every error response.
 *
 * Two jobs. For a route that declares no policy of its own it supplies the most restrictive
 * one, so a new route inherits "do not cache" until someone decides otherwise — the failure
 * mode of forgetting is a slow page, not one user seeing another's.
 *
 * For a thrown Response it is the boundary, and a boundary's headers replace the leaf's. The
 * `Cache-Control` a loader put on its thrown Response would otherwise be silently dropped
 * (verified: a 404 came back `no-store` despite asking for a short TTL), so `errorHeaders` is
 * consulted and honoured here.
 */
export function headers({ errorHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': errorHeaders?.get('Cache-Control') ?? PRIVATE_NO_STORE };
}

export const links: LinksFunction = () => [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
];

/**
 * The server-rendered document. Everything outside <Outlet /> is shared by every
 * route, which is why the providers and the navbar live here rather than in a
 * separate App component.
 */
export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en" data-theme="dark">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <Meta />
                <Links />
            </head>
            <body>
                {children}
                <ScrollRestoration />
                <Scripts />
            </body>
        </html>
    );
}

export default function Root() {
    return (
        <AuthProvider>
            <ListsProvider>
                <WishlistProvider>
                    <div className="app-root">
                        <Navbar />
                        <main className="flex-1">
                            <Outlet />
                        </main>
                    </div>
                </WishlistProvider>
            </ListsProvider>
        </AuthProvider>
    );
}

/**
 * Catches both thrown route responses (404s) and unexpected render/loader errors,
 * so a bad URL renders a real page instead of a blank layout.
 */
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
    let title = 'Something went wrong';
    let detail = 'An unexpected error occurred. Please try again.';

    if (isRouteErrorResponse(error)) {
        title = error.status === 404 ? 'Page not found' : `${error.status} ${error.statusText}`;
        detail = error.status === 404
            ? "We couldn't find the page you were looking for."
            : error.data ?? detail;
    } else if (import.meta.env.DEV && error instanceof Error) {
        detail = error.message;
    }

    // Rendered outside AuthProvider/ListsProvider — the error may well have come from
    // one of them — so this must not use Navbar or any context-dependent component.
    return (
        <div className="app-root">
            <main className="flex-1 flex items-center justify-center py-24 px-4">
                <div className="text-center max-w-md">
                    <h1 className="text-3xl font-bold text-white light:text-slate-900 mb-3">{title}</h1>
                    <p className="text-slate-400 light:text-slate-600 mb-8">{detail}</p>
                    <a
                        href="/"
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors"
                    >
                        Back to home
                    </a>
                </div>
            </main>
        </div>
    );
}
