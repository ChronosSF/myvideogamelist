import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
    index('pages/HomePage.tsx'),
    route('games', 'pages/GamesPage.tsx'),
    route('games/:id', 'pages/GamePage.tsx'),
    route('lists', 'pages/ListsPage.tsx'),
    route('wishlist', 'pages/WishlistPage.tsx'),
    route('user', 'pages/UserPage.tsx'),

    // Somebody else's profile, and the only route addressed by a name the user chose. Under `/u/`
    // rather than at the top level so that a username can never collide with a route — see the
    // reserved list in `UserNamePolicy` for why that is belt as well as braces.
    route('u/:userName', 'pages/ProfilePage.tsx'),

    // Anything else renders the root ErrorBoundary as a 404.
    route('*', 'pages/NotFoundPage.tsx'),
] satisfies RouteConfig;
