import { Link } from 'react-router-dom';

export function HomePage() {
    return (
        <div className="min-h-screen bg-slate-900 flex flex-col">
            {/* Hero Section */}
            <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-blue-950 via-slate-900 to-slate-900 relative overflow-hidden">
                {/* Background decoration */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
                    <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
                    <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-blue-800/10 rounded-full blur-3xl" />
                </div>

                <div className="relative text-center px-4 sm:px-6 py-20 max-w-3xl mx-auto">
                    {/* Icon */}
                    <div className="flex justify-center mb-6">
                        <div className="w-20 h-20 bg-blue-600/20 border border-blue-500/30 rounded-2xl flex items-center justify-center">
                            <svg className="w-10 h-10 text-blue-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path d="M21 6.5a2.5 2.5 0 00-2.5-2.5H5.5A2.5 2.5 0 003 6.5v11A2.5 2.5 0 005.5 20h13a2.5 2.5 0 002.5-2.5v-11zM8 15.5a.5.5 0 01-.5-.5V9a.5.5 0 011 0v6a.5.5 0 01-.5.5zm4 0a.5.5 0 01-.5-.5V9a.5.5 0 011 0v6a.5.5 0 01-.5.5zm4-3a.5.5 0 01-.5-.5v-3a.5.5 0 011 0v3a.5.5 0 01-.5.5z" />
                            </svg>
                        </div>
                    </div>

                    <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white mb-4 leading-tight">
                        My<span className="text-blue-400">VideoGame</span>List
                    </h1>
                    <p className="text-slate-400 text-lg sm:text-xl mb-10 max-w-xl mx-auto leading-relaxed">
                        Track your gaming journey. Discover, organize, and share every game you've played.
                    </p>

                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                        <Link
                            to="/games"
                            className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-900/40"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            Browse Games
                        </Link>
                    </div>
                </div>
            </div>

            {/* Features row */}
            <div className="bg-slate-800/50 border-t border-slate-700/50">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-3 gap-8 text-center">
                    {[
                        {
                            icon: (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h10" />
                            ),
                            title: 'Track',
                            description: 'Keep track of every game — playing, completed, backlog, and more.',
                        },
                        {
                            icon: (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
                            ),
                            title: 'Discover',
                            description: 'Browse our growing catalog of games across all platforms.',
                        },
                        {
                            icon: (
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                            ),
                            title: 'Rate',
                            description: 'Score and review games to help the community find the best titles.',
                        },
                    ].map(feature => (
                        <div key={feature.title} className="flex flex-col items-center gap-3">
                            <div className="w-12 h-12 bg-blue-900/40 border border-blue-700/30 rounded-xl flex items-center justify-center">
                                <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    {feature.icon}
                                </svg>
                            </div>
                            <h2 className="text-white font-semibold text-base">{feature.title}</h2>
                            <p className="text-slate-400 text-sm leading-relaxed">{feature.description}</p>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
