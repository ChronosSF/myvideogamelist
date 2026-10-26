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
import { AuthDialogProvider } from '@/contexts/AuthDialogProvider';
import { ListsProvider } from '@/contexts/ListsProvider';
import { WishlistProvider } from '@/contexts/WishlistProvider';
import { FavouritesProvider } from '@/contexts/FavouritesProvider';
import { TagsProvider } from '@/contexts/TagsProvider';
import { SearchPacerProvider } from '@/contexts/SearchPacerProvider';
import { Navbar } from '@/components/Navbar';
import { SiteFooter } from '@/components/SiteFooter';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { isUpstreamFailure } from '@/lib/trace';
import { traceMiddleware } from '@/lib/trace.server';
import archivoDisplay from '@/assets/fonts/archivo-display-latin.woff2?url';
import archivoTitle from '@/assets/fonts/archivo-title-latin.woff2?url';
import schibstedLatin from '@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2?url';
import './index.css';
import './App.css';

/**
 * Every request this server handles draws its trace here, before any loader runs, and answers with
 * its id in `X-Trace-Id`. The loaders send it to the API as `traceparent`; see `@/lib/trace.server`
 * and ADR 0059. Server middleware, which React Router leaves out of the browser's bundle.
 */
export const middleware: Route.MiddlewareFunction[] = [traceMiddleware];

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

/**
 * The font files nearly every page draws in, Archivo's two faces and Schibsted Grotesk, in Latin, fetched
 * with the stylesheet rather than once the page's text asks for them, so that a first visit spends as
 * little of its load as it can in the fallback and its text does not move when they arrive (`type.css`).
 * Leaving them to the text costs a phone more than it saves: they still start before the first paint,
 * only later, and the swap shifts the layout. The same URLs the stylesheet's `@font-face` rules name, so
 * the preload is the request they use; `crossOrigin` because fonts are always fetched in CORS mode, and a
 * preload without it would be fetched twice.
 */
export const links: LinksFunction = () => [
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'preload', as: 'font', type: 'font/woff2', href: archivoDisplay, crossOrigin: 'anonymous' },
    { rel: 'preload', as: 'font', type: 'font/woff2', href: archivoTitle, crossOrigin: 'anonymous' },
    { rel: 'preload', as: 'font', type: 'font/woff2', href: schibstedLatin, crossOrigin: 'anonymous' },
];

/**
 * The server-rendered document. Everything outside <Outlet /> is shared by every
 * route, which is why the providers and the navbar live here rather than in a
 * separate App component.
 */
export function Layout({ children }: { children: React.ReactNode }) {
    return (
        <html lang="en">
            <head>
                <meta charSet="UTF-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                <Meta />
                {/*
                  An explicit empty nonce, so that the links render the same on both sides.
                  Left alone, <Links> takes the render's nonce from <ServerRouter> while the
                  hydrating client has none, and a browser blanks a nonce attribute once it has
                  read it. React compares a stylesheet link's attributes when it hydrates it, so the
                  server's nonce="" against no attribute on the client is a hydration mismatch,
                  which in development the critical-CSS link reports on every page. A link needs no
                  nonce under this policy: same-origin preloads are admitted by 'self', and no
                  style-src is set. A style-src naming the nonce would change that; see ADR 0053 §5.
                */}
                <Links nonce="" />
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
                    <FavouritesProvider>
                        {/* Around the navbar and the pages both: their searches spend one budget. */}
                        <SearchPacerProvider>
                            <div className="app-root">
                                {/* Around the navbar and the pages both: either may ask somebody to sign in. */}
                                <AuthDialogProvider>
                                    <Navbar />
                                    <main className="flex-1">
                                        {/* Around the pages alone: the navbar and the footer draw no tag. */}
                                        <TagsProvider>
                                            <Outlet />
                                        </TagsProvider>
                                    </main>
                                    <SiteFooter />
                                </AuthDialogProvider>
                            </div>
                        </SearchPacerProvider>
                    </FavouritesProvider>
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
    // The id of the request that failed, when the failure says. Rendered on the server and again
    // from the same error while hydrating, so both sides show the same text.
    let reference: string | null = null;

    if (isRouteErrorResponse(error)) {
        title = error.status === 404 ? 'Page not found' : `${error.status} ${error.statusText}`;

        if (isUpstreamFailure(error.data)) {
            detail = error.data.message;
            reference = error.data.traceId;
        } else if (error.status === 404) {
            detail = "We couldn't find the page you were looking for.";
        } else if (typeof error.data === 'string' && error.data !== '') {
            detail = error.data;
        }
    } else if (import.meta.env.DEV && error instanceof Error) {
        detail = error.message;
    }

    // Rendered outside AuthProvider/ListsProvider — the error may well have come from
    // one of them — so this must not use Navbar or any context-dependent component. The footer
    // uses none: only the router's links, and the router is what renders this.
    return (
        <div className="app-root">
            <main className="flex-1 flex items-center justify-center py-24 px-4">
                <div className="text-center max-w-md">
                    <h1 className="type-display text-4xl text-fg-strong mb-4">{title}</h1>
                    <p className="text-fg-muted mb-8">{detail}</p>
                    {reference && (
                        // What somebody reporting this can quote: the id on the API's lines for the
                        // failed call, or on this server's line when the call never reached it.
                        <p className="text-sm text-fg-faint -mt-4 mb-8">
                            If you report this, quote{' '}
                            <code className="font-mono text-fg-soft select-all break-all">{reference}</code>.
                        </p>
                    )}
                    <a
                        href="/"
                        className="inline-flex items-center gap-2 px-5 py-2.5 btn-primary"
                    >
                        Back to home
                    </a>
                </div>
            </main>
            <SiteFooter />
        </div>
    );
}
