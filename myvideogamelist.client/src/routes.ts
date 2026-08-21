import { type RouteConfig, index, route } from '@react-router/dev/routes';

export default [
    index('pages/HomePage.tsx'),
    route('games', 'pages/GamesPage.tsx'),
    route('games/:id', 'pages/GamePage.tsx'),
    route('lists', 'pages/ListsPage.tsx'),
    route('user', 'pages/UserPage.tsx'),

    // Anything else renders the root ErrorBoundary as a 404.
    route('*', 'pages/NotFoundPage.tsx'),
] satisfies RouteConfig;
