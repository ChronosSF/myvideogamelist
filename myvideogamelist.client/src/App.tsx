import { Outlet } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthProvider';
import { ListsProvider } from '@/contexts/ListsProvider';
import { Navbar } from '@/components/Navbar';
import './App.css';

function AppLayout() {
    return (
        <div className="app-root">
            <Navbar />
            <main className="flex-1">
                <Outlet />
            </main>
        </div>
    );
}

function App() {
    return (
        <AuthProvider>
            <ListsProvider>
                <AppLayout />
            </ListsProvider>
        </AuthProvider>
    );
}

export default App;
