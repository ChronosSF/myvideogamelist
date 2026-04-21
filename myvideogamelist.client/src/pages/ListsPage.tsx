import { useState } from 'react';
import { Link } from 'react-router-dom';
import { GameCard } from '@/components/GameCard';
import { useLists } from '@/hooks/useLists';
import { type ListId, LIST_IDS, LIST_NAMES } from '@/types/list';
import './ListsPage.css';

export function ListsPage() {
    const { lists } = useLists();
    const [activeTab, setActiveTab] = useState<ListId>('playing');

    const games = lists[activeTab];

    return (
        <div className="min-h-screen">
            {/* Page header */}
            <div className="bg-gradient-to-b from-blue-950/60 to-slate-900 light:from-blue-50/80 light:to-slate-50 border-b border-slate-700/50 light:border-slate-200">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                    <h1 className="text-3xl sm:text-4xl font-bold text-white light:text-slate-900 mb-1">My Lists</h1>
                    <p className="text-slate-400 light:text-slate-600 text-sm sm:text-base">
                        Track your games across different stages.
                    </p>

                    {/* Tabs */}
                    <div className="lists-tabs" role="tablist" aria-label="Game lists">
                        {LIST_IDS.map(id => (
                            <button
                                key={id}
                                role="tab"
                                aria-selected={activeTab === id}
                                className={`lists-tab-btn${activeTab === id ? ' active' : ''}`}
                                onClick={() => setActiveTab(id)}
                            >
                                {LIST_NAMES[id]}
                                <span className="lists-tab-count">{lists[id].length}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" role="tabpanel">
                {games.length === 0 ? (
                    <div className="flex items-center justify-center py-24">
                        <div className="text-center">
                            <svg
                                className="w-14 h-14 text-slate-700 light:text-slate-300 mx-auto mb-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <p className="text-slate-400 light:text-slate-600 font-medium mb-3">
                                No games in {LIST_NAMES[activeTab]} yet.
                            </p>
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition-colors"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Browse Games
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                        {games.map(game => (
                            <GameCard key={game.id} game={game} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
