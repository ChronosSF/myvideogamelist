import { Link, NavLink } from 'react-router-dom';

export function Navbar() {
    return (
        <header className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700/50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14">
                    {/* Logo / Brand */}
                    <Link to="/" className="flex items-center gap-2 text-white font-bold text-lg hover:text-blue-400 transition-colors">
                        <svg className="w-7 h-7 text-blue-500" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M21 6.5a2.5 2.5 0 00-2.5-2.5H5.5A2.5 2.5 0 003 6.5v11A2.5 2.5 0 005.5 20h13a2.5 2.5 0 002.5-2.5v-11zM8 15.5a.5.5 0 01-.5-.5V9a.5.5 0 011 0v6a.5.5 0 01-.5.5zm4 0a.5.5 0 01-.5-.5V9a.5.5 0 011 0v6a.5.5 0 01-.5.5zm4-3a.5.5 0 01-.5-.5v-3a.5.5 0 011 0v3a.5.5 0 01-.5.5z" />
                        </svg>
                        <span>MyVideoGameList</span>
                    </Link>

                    {/* Navigation Links */}
                    <nav className="flex items-center gap-1" aria-label="Main navigation">
                        <NavLink
                            to="/"
                            end
                            className={({ isActive }) =>
                                `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    isActive
                                        ? 'bg-blue-600/20 text-blue-400'
                                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                }`
                            }
                        >
                            Home
                        </NavLink>
                        <NavLink
                            to="/games"
                            className={({ isActive }) =>
                                `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                                    isActive
                                        ? 'bg-blue-600/20 text-blue-400'
                                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                                }`
                            }
                        >
                            Games
                        </NavLink>
                    </nav>
                </div>
            </div>
        </header>
    );
}
