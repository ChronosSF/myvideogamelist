import { Link, data } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ContinuePlayingRail } from '@/components/ContinuePlayingRail';
import { HomeStatsStrip } from '@/components/HomeStatsStrip';
import { UpcomingTimeline } from '@/components/UpcomingTimeline';
import { TrendingRail } from '@/components/TrendingRail';
import { NewsCard } from '@/components/NewsCard';
import { apiUrl } from '@/lib/api';
import { CACHE_HOME, PRIVATE_NO_STORE } from '@/lib/cache';
import type { UserProfile } from '@/types/auth';
import type { HomeResponse } from '@/types/news';
import type { Route } from './+types/HomePage';
import './HomePage.css';

/**
 * Normally the shared home policy, but the loader overrides it when it degrades.
 *
 * Without that override an IGDB outage would be cached: the page still answers 200, so the CDN
 * would happily pin an empty home page for the full window and keep serving it long after the
 * upstream recovered. Caching a failure outlives the failure.
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': loaderHeaders.get('Cache-Control') ?? CACHE_HOME };
}

export function meta() {
    return [
        { title: 'MyVideoGameList - Track every game you play' },
        { name: 'description', content: 'Track the games you have played, build a backlog and wishlist, and see what is releasing next across every platform.' },
        { property: 'og:title', content: 'MyVideoGameList - Track every game you play' },
        { property: 'og:description', content: 'Track the games you have played, build a backlog and wishlist, and see what is releasing next across every platform.' },
        { property: 'og:type', content: 'website' },
    ];
}

/**
 * One request for the whole shared page (ROADMAP §3.5).
 *
 * A failure here degrades rather than throws: the calendar below loads separately on the
 * client and still works, so a dead IGDB should cost the rails and nothing more. That is the
 * opposite of the game route, where an upstream failure genuinely means there is no page.
 */
export async function loader() {
    // A degraded render must not be cached, so it carries its own no-store header. `data()` is
    // how a loader attaches headers to an otherwise plain return value.
    const degraded = () => data<HomeResponse>(
        { spotlight: null, popular: [], news: [] },
        { headers: { 'Cache-Control': PRIVATE_NO_STORE } });

    try {
        const response = await fetch(apiUrl('/api/home'));
        if (!response.ok) return degraded();

        return (await response.json()) as HomeResponse;
    } catch {
        // fetch rejects outright when the API is unreachable, rather than returning !ok.
        return degraded();
    }
}

function SectionHeading({ id, title, subtitle, action }: {
    id: string;
    title: string;
    subtitle: string;
    action?: { to: string; label: string };
}) {
    return (
        <div className="flex items-end justify-between gap-4 mb-5">
            <div>
                <h2 id={id} className="text-xl sm:text-2xl font-bold text-white light:text-slate-900">{title}</h2>
                <p className="text-sm text-slate-400 light:text-slate-600 mt-1">{subtitle}</p>
            </div>

            {action && (
                <Link
                    to={action.to}
                    className="shrink-0 text-sm font-medium text-blue-400 light:text-blue-600 hover:text-blue-300 light:hover:text-blue-700 transition-colors"
                >
                    {action.label} <span aria-hidden="true">→</span>
                </Link>
            )}
        </div>
    );
}

/**
 * What a returning user lands on instead of the pitch (ROADMAP H1).
 *
 * Rendered only after hydration, and unavoidably so: this page is shared-cached, the server render
 * has no cookie, and `AuthProvider` learns who the user is from a fetch. So a signed-in visitor
 * sees the landing hero for the length of one request and then this. Fixing that properly means a
 * cookie-varying SSR render and a CloudFront behaviour to match, which is ROADMAP D12's problem
 * rather than this component's.
 */
function SignedInHero({ user }: { user: UserProfile }) {
    return (
        <section className="signed-in-hero">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
                <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-white light:text-slate-900">
                            Welcome back, {user.userName}
                        </h1>
                        <p className="text-sm text-slate-400 light:text-slate-600 mt-1">
                            Pick up where you left off.
                        </p>
                    </div>

                    <Link
                        to="/lists"
                        className="shrink-0 text-sm font-medium text-blue-400 light:text-blue-600 hover:text-blue-300 light:hover:text-blue-700 transition-colors"
                    >
                        All your lists <span aria-hidden="true">→</span>
                    </Link>
                </div>

                <HomeStatsStrip userId={user.id} />

                <h2 className="text-lg font-semibold text-white light:text-slate-900 mt-8 mb-4">
                    Continue playing
                </h2>
                <ContinuePlayingRail />
            </div>
        </section>
    );
}

/** The pitch, for a visitor who has not signed in — and for the server render, which never has. */
function LandingHero({ spotlight }: { spotlight: HomeResponse['spotlight'] }) {
    return (
        <>
            {/* ── Hero ────────────────────────────────────────────────
                Compact by design. The old full-viewport hero pushed every piece of real
                content below the fold; this keeps the pitch but lets the trending covers
                start showing immediately. */}
            <section className="relative overflow-hidden border-b border-slate-800 light:border-slate-200">
                {spotlight?.backgroundImageUrl ? (
                    <>
                        <img
                            src={spotlight.backgroundImageUrl}
                            alt=""
                            className="absolute inset-0 w-full h-full object-cover"
                        />
                        {/*
                          * Two layers: a horizontal ramp keeps the left-hand text legible, and a
                          * vertical one lands the section on the page background instead of an edge.
                          *
                          * The scrim inverts with the theme. Keeping it dark in light mode left a
                          * slab of night beside a white page: the text passed contrast against the
                          * scrim, but the eye adapts to the bright surroundings and the banner's
                          * mid-tones read as murky anyway.
                          */}
                        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/90 to-slate-950/40 light:from-white light:via-white/92 light:to-white/50" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent light:from-slate-50" />
                    </>
                ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-blue-950 via-slate-900 to-slate-900 light:from-blue-100 light:via-slate-50 light:to-white" />
                )}

                <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-14 sm:py-20">
                    <div className="max-w-2xl">
                        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-white light:text-slate-900 mb-4 leading-tight">
                            Every game you&apos;ve played,{' '}
                            <span className="text-blue-400 light:text-blue-700">in one list</span>
                        </h1>
                        <p className="text-slate-300 light:text-slate-700 text-base sm:text-lg mb-8 leading-relaxed">
                            Track what you&apos;re playing, park what you&apos;ll get to eventually, and
                            never miss a release date again.
                        </p>

                        <div className="flex flex-wrap items-center gap-3">
                            <Link
                                to="/games"
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-colors shadow-lg shadow-blue-950/50"
                            >
                                Browse games
                            </Link>
                            <Link
                                to="/lists"
                                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 hover:bg-white/20 light:bg-slate-900/5 light:hover:bg-slate-900/10 backdrop-blur-sm text-white light:text-slate-900 font-semibold rounded-xl transition-colors border border-white/15 light:border-slate-900/15"
                            >
                                My lists
                            </Link>
                        </div>

                        {spotlight && (
                            <p className="mt-8 text-xs text-slate-400 light:text-slate-600">
                                Pictured:{' '}
                                <Link
                                    to={`/games/${spotlight.id}`}
                                    className="text-slate-300 light:text-slate-700 hover:text-blue-400 light:hover:text-blue-700 underline underline-offset-2 transition-colors"
                                >
                                    {spotlight.title}
                                </Link>
                            </p>
                        )}
                    </div>
                </div>
            </section>
        </>
    );
}

export function HomePage({ loaderData }: Route.ComponentProps) {
    const { spotlight, popular, news } = loaderData;
    const { user, loading } = useAuth();

    return (
        <div className="min-h-screen">
            {/* The landing hero while auth is still unknown, which includes every server render.
                The alternative — nothing until `me` answers — flashes an empty page at the one
                visitor the pitch is written for. */}
            {user && !loading
                ? <SignedInHero user={user} />
                : <LandingHero spotlight={spotlight} />}

            {/* Everything below is the same for both. Trending, the news and the calendar are
                worth seeing whether or not anybody is signed in, and duplicating them into two
                branches is how the two drift. */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
                {popular.length > 0 && (
                    <section className="py-10 sm:py-12" aria-labelledby="trending-heading">
                        <SectionHeading
                            id="trending-heading"
                            title="Trending right now"
                            subtitle="The most-played games on Steam today"
                            action={{ to: '/games', label: 'Browse all' }}
                        />
                        <TrendingRail games={popular} />
                    </section>
                )}

                {news.length > 0 && (
                    <section className="py-10 sm:py-12 border-t border-slate-800/60 light:border-slate-200" aria-labelledby="news-heading">
                        <SectionHeading
                            id="news-heading"
                            title="Latest news"
                            subtitle="Patch notes and announcements from the games people are playing"
                        />

                        {/* grid-cols-1, not an implicit column: that one sizes to its content, and
                            a card's truncated source line counts at full length — wider than a phone. */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            {news.map(item => (
                                <NewsCard key={item.id} item={item} />
                            ))}
                        </div>
                    </section>
                )}
            </div>

            {/* Keeps its own client-side fetch: the calendar is filtered by the viewer's hidden
                platforms, so unlike everything above it cannot be cached once for everyone. */}
            <UpcomingTimeline />
        </div>
    );
}

export default HomePage;
