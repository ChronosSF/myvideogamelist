import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';
import App from './App.tsx';
import { HomePage } from '@/pages/HomePage.tsx';
import { GamesPage } from '@/pages/GamesPage.tsx';
import { GamePage } from '@/pages/GamePage.tsx';
import { UserPage } from '@/pages/UserPage.tsx';
import { ListsPage } from '@/pages/ListsPage.tsx';

const router = createBrowserRouter([
    {
        path: '/',
        element: <App />,
        children: [
            { index: true, element: <HomePage /> },
            { path: 'games', element: <GamesPage /> },
            { path: 'games/:id', element: <GamePage /> },
            { path: 'lists', element: <ListsPage /> },
            { path: 'user', element: <UserPage /> },
        ],
    },
]);

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <RouterProvider router={router} />
    </StrictMode>,
);
