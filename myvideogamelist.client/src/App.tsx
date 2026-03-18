import { Outlet } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import './App.css';

function App() {
    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            <Navbar />
            <main className="flex-1">
                <Outlet />
            </main>
        </div>
    );
}

export default App;
