import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
    index('pages/HomePage.tsx'),
    route('games', 'pages/GamesPage.tsx'),
    route('games/:id', 'pages/GamePage.tsx'),
    route('lists', 'pages/ListsPage.tsx'),
    route('wishlist', 'pages/WishlistPage.tsx'),
    route('news', 'pages/NewsPage.tsx'),
    route('user', 'pages/UserPage.tsx'),

    // Somebody else's profile, and the only route addressed by a name the user chose. Under `/u/`
    // rather than at the top level so that a username can never collide with a route — see the
    // reserved list in `UserNamePolicy` for why that is belt as well as braces.
    route('u/:userName', 'pages/ProfilePage.tsx'),

    // What a crawler reads rather than a person. Resource routes: a loader and no component, so
    // each returns its own Response and none passes through `entry.server.tsx`. Routes rather than
    // files in `public/`, because what they say depends on the deployment answering — see
    // `docs/decisions/0036-*`.
    route('robots.txt', 'resources/robotsTxt.ts'),
    route('sitemap.xml', 'resources/sitemapIndex.ts'),
    route('sitemaps/:file', 'resources/sitemapFile.ts'),

    // Anything else renders the root ErrorBoundary as a 404.
    route('*', 'pages/NotFoundPage.tsx'),
] satisfies RouteConfig;
