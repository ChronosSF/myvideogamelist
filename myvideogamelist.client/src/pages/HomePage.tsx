import { Link, data } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ComingSoonSchedule } from '@/components/ComingSoonSchedule';
import { ContinuePlayingRail } from '@/components/ContinuePlayingRail';
import { ContinuePlayingSkeleton } from '@/components/ContinuePlayingSkeleton';
import { HomeSectionHeading } from '@/components/HomeSectionHeading';
import { HomeStatsStrip } from '@/components/HomeStatsStrip';
import { HomeStatsStripSkeleton } from '@/components/HomeStatsStripSkeleton';
import { PlayNextPicker } from '@/components/PlayNextPicker';
import { PlayNextSkeleton } from '@/components/PlayNextSkeleton';
import { ReleaseLine } from '@/components/ReleaseLine';
import { ReleaseLineSkeleton } from '@/components/ReleaseLineSkeleton';
import { ShowcasesAndSales } from '@/components/ShowcasesAndSales';
import { JustOutRail } from '@/components/JustOutRail';
import { WelcomePanel } from '@/components/WelcomePanel';
import { NewsCard } from '@/components/NewsCard';
import { CACHE_HOME, PRIVATE_NO_STORE } from '@/lib/cache';
import { utcDay } from '@/lib/daySpan';
import { type SiteConfig, pageMeta, siteConfig } from '@/lib/seo';
import { signedInFlagIn } from '@/lib/signedInFlag';
import { siteStructuredData } from '@/lib/structuredData';
import { loaderFetch } from '@/lib/trace.server';
import type { UserProfile } from '@/types/auth';
import type { HomeResponse } from '@/types/news';
import type { CalendarEvents, ComingSoonGame, JustOutGame } from '@/types/releases';
import type { Route } from './+types/HomePage';
import './HomePage.css';

/**
 * Whatever the loader decided, which is the shared home policy only for an answer that is whole.
 *
 * Without the loader's say an IGDB outage would be cached: the page still answers 200, so the CDN
 * would happily pin an empty home page for the full window and keep serving it long after the
 * upstream recovered. Caching a failure outlives the failure.
 *
 * The loader states a policy on every return, so the fallback is for a loader that has stopped
 * doing so, and it fails closed as the root does. Falling back to `CACHE_HOME` would make this a
 * second place the shared policy is handed out, and the one where nobody had judged the answer.
 */
export function headers({ loaderHeaders }: Route.HeadersArgs) {
    return { 'Cache-Control': loaderHeaders.get('Cache-Control') ?? PRIVATE_NO_STORE };
}

export function meta({ loaderData }: Route.MetaArgs) {
    // The site's name, address and search, as structured data, which Google reads for the name it
    // shows over a result — and only from the home page (ADR 0069).
    return [...pageMeta({
        site: loaderData.site,
        title: 'MyVideoGameList - Track every game you play',
        description: 'Track the games you have played, build a backlog and wishlist, and see when the games you are waiting for come out.',
        path: '/',
    }), ...siteStructuredData(loaderData.site)];
}

/**
 * The shared page's content, the deployment's public address for `meta` to build URLs from, and the
 * day the page was rendered for.
 */
type HomeData = HomeResponse & {
    site: SiteConfig;
    /**
     * Today in UTC when the loader ran, `YYYY-MM-DD`. The showcases and sales count down from it until
     * the page hydrates and can ask the reader's own clock; it travels in the loader data so that the
     * render hydrating the page counts from the same day the server did.
     */
    today: string;
    /**
     * Whether the request carried the cookie that says its browser is signed in, and nothing about who
     * (ADR 0074). The page draws the signed-in top section from it until `/api/auth/me` has answered. The
     * edge keeps a copy of the page for each value, so this is the only thing the two copies differ by.
     */
    signedInFlag: boolean;
};

/**
 * What `/api/home` answers. The showcases and sales and the two release panels are optional here, though
 * not in the type the page is handed: an API older than this build, in the middle of a deploy, sends none.
 */
type HomeAnswer = Omit<HomeResponse, 'events' | 'comingSoon' | 'justOut'>
    & { events?: CalendarEvents; comingSoon?: ComingSoonGame[]; justOut?: JustOutGame[] };

/** The showcases and sales of an answer that brought none, which is not the same as none being on. */
const NO_EVENTS: CalendarEvents = { curated: [], showcases: [], degraded: true };

/**
 * One request for the whole shared page (ROADMAP §3.5).
 *
 * A failure here degrades rather than throws: a dead IGDB should cost the rails and the showcases,
 * and nothing more.
 * That is the opposite of the game route, where an upstream failure genuinely means there is no
 * page.
 */
export async function loader({ context, request }: Route.LoaderArgs) {
    const site = siteConfig();
    const today = utcDay(new Date());
    // The one cookie the edge lets through to this page, and the one it keys the page on (ADR 0074).
    // Locally there is no edge, and the browser's own cookies arrive; this reads the flag and no other.
    const signedInFlag = signedInFlagIn(request.headers.get('Cookie'));

    // A degraded render must not be cached, and a 200 from the API does not mean the render is
    // whole: it answers 200 when IGDB or Steam fails too, so that the page still renders, and its
    // status cannot say which of the two this is. The payload does. The API already makes that
    // judgement to decide how long to keep its own copy, and sends it, rather than this loader
    // guessing from an empty rail — a full rail of covers with no news beside it is degraded as
    // well, and a guess made here would have to be taught that separately.
    //
    // Only an answer that says it is whole gets the shared policy. One that does not say, such as
    // an API older than this build in the middle of a deploy, fails closed like the root's default:
    // what a missing flag costs is a slow page, never a failure pinned at the edge.
    //
    // `data()` is how a loader attaches headers to an otherwise plain return value. The flag is
    // normalized on the way through, so an answer that did not say is *recorded* as degraded rather
    // than merely treated as one: spread as it arrived, the page would be handed a payload whose
    // `degraded` is undefined while its type promises a boolean, and the rule — only an explicit
    // `false` is whole — would be stated here for the header and again by whoever reads it next.
    //
    // An answer with no showcases and sales is one from an API older than this build, which says it
    // is whole because, as far as it knows, it is. It is missing a part all the same, and kept at the
    // edge it would go on serving a page without the panel after the API caught up — so it is
    // degraded too, normalized the same way, rather than trusted for what it did not know to say. So
    // is an answer with no Coming soon or Just out panel, for the same reason.
    const respond = (home: HomeAnswer) => {
        const events = home.events ?? null;
        const comingSoon = home.comingSoon ?? null;
        const justOut = home.justOut ?? null;
        const degraded = home.degraded !== false || events === null || comingSoon === null || justOut === null;

        return data<HomeData>(
            {
                news: home.news, events: events ?? NO_EVENTS, comingSoon: comingSoon ?? [], justOut: justOut ?? [],
                degraded, site, today, signedInFlag,
            },
            { headers: { 'Cache-Control': degraded ? PRIVATE_NO_STORE : CACHE_HOME } });
    };

    // What is left of the page when the API gave nothing to build it from.
    const nothing = () => respond({ news: [], events: NO_EVENTS, comingSoon: [], justOut: [], degraded: true });

    try {
        const response = await loaderFetch(context, '/api/home');
        if (!response.ok) return nothing();

        return respond(await response.json() as HomeAnswer);
    } catch {
        // fetch rejects outright when the API is unreachable, rather than returning !ok.
        return nothing();
    }
}

/**
 * What a returning user lands on instead of the welcome panel (ROADMAP H1).
 *
 * Drawn before anybody knows who the reader is, for a request whose browser carried the signed-in flag
 * (ADR 0074): the page is shared-cached, so its server render may hold nothing of anybody's, and with
 * `user` null each of the reader's own parts is its skeleton, the same one that part shows while it loads.
 * Once `/api/auth/me` has named the reader the parts are drawn, and fill their skeletons' places. The
 * line is never drawn by a server render, which cannot know the reader's day.
 */
function SignedInHero({ user }: { user: UserProfile | null }) {
    return (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-14">
            <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-3 mb-8">
                <h1 className="type-display text-4xl sm:text-6xl text-fg-strong text-balance">
                    Welcome back{user !== null && <>, <span className="text-primary-400">{user.userName}</span></>}
                </h1>

                <Link
                    to="/lists"
                    className="shrink-0 text-sm font-semibold text-link"
                >
                    All your lists <span aria-hidden="true">→</span>
                </Link>
            </div>

            {user !== null ? <HomeStatsStrip userId={user.id} /> : <HomeStatsStripSkeleton />}

            {/* Side by side where there is room: what you are playing, and beside it what to play once
                that is done. Starting the pick moves it into the list beside. */}
            <div className="mt-12 flex flex-wrap items-start gap-x-14 gap-y-10">
                <section className="flex-[999_1_34rem] min-w-0 border-t border-line pt-4" aria-labelledby="continue-playing-heading">
                    <h2 id="continue-playing-heading" className="type-kicker text-fg-muted mb-4">Continue playing</h2>
                    {user !== null ? <ContinuePlayingRail /> : <ContinuePlayingSkeleton />}
                </section>

                <section className="flex-[1_1_18rem] min-w-0 rule-heavy pt-4" aria-labelledby="play-next-heading">
                    <h2 id="play-next-heading" className="type-kicker text-fg-muted mb-4">Play next</h2>
                    {user !== null ? <PlayNextPicker /> : <PlayNextSkeleton />}
                </section>
            </div>

            {/* Last in the hero, so directly above the panels everybody sees, which matter less to
                somebody signed in than their own games do (L1). Brings its own heading, because
                its sentence for an empty two weeks belongs inside the line it describes. */}
            <div className="mt-16 sm:mt-20">
                {user !== null ? <ReleaseLine userId={user.id} /> : <ReleaseLineSkeleton />}
            </div>
        </section>
    );
}

export function HomePage({ loaderData }: Route.ComponentProps) {
    // `events` has a default although the loader always sets it: a navigation inside the app fetches
    // the loader's data on its own, and in a deploy's first minutes the edge can still hold one written
    // by the build before this one, which has no showcases and sales at all. Without the default that
    // payload would be a TypeError, and the page its error boundary. `comingSoon` and `justOut` likewise,
    // for a copy written before the panel existed.
    // `signedInFlag` too, false for a copy written before the flag existed.
    const { news, events = NO_EVENTS, comingSoon = [], justOut = [], today, signedInFlag = false } = loaderData;
    const { user, loading } = useAuth();

    // Whose top section to draw. Until `me` answers — every server render, and the render that hydrates
    // it — the flag the request carried decides, so a signed-in reader's page arrives as theirs and a
    // visitor's as the welcome (ADR 0074); once it has, the answer does. A flag left over from a session
    // that ended costs that one page its placeholders, then the welcome panel, as every page cost before.
    const signedIn = loading ? signedInFlag : user !== null;

    return (
        <div className="min-h-screen">
            {signedIn
                ? <SignedInHero user={loading ? null : user} />
                : <WelcomePanel />}

            {/* Everything below is the same for both, but for the showcases and sales, which give
                way to the line. The panels and the news are worth seeing whether or not anybody is
                signed in, and duplicating them into two branches is how the two drift. Each section
                opens with its heading's heavy rule, so whichever of them are drawn are set apart:
                any of them can be missing. */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
                {/* Where the two-week line is for somebody signed in, directly above Coming soon, and
                    giving way to it: the line shows these same events on the same days, beside the
                    reader's own releases, and the two together would be every sale twice, one under
                    the other (ADR 0063). It goes with the welcome panel, so in the same render. */}
                {!signedIn && <ShowcasesAndSales events={events} today={today} />}

                {/* For everybody, after the reader's own two weeks or the showcases standing in for them:
                    what is coming over three months, then what came out over the three before (ADR 0071,
                    0073). A game on somebody's line may be here too, which is the panel saying it is a big
                    one; the two panels meet on today and never hold the same game. */}
                {comingSoon.length > 0 && (
                    <section className="pt-16 sm:pt-20" aria-labelledby="coming-soon-heading">
                        <HomeSectionHeading
                            id="coming-soon-heading"
                            title="Coming soon"
                            subtitle="The new games most followed on IGDB, out in the next three months"
                        />
                        <ComingSoonSchedule games={comingSoon} today={today} />
                    </section>
                )}

                {justOut.length > 0 && (
                    <section className="pt-16 sm:pt-20" aria-labelledby="just-out-heading">
                        <HomeSectionHeading
                            id="just-out-heading"
                            title="Just out"
                            subtitle="The new games most watched on Twitch, out in the last three months"
                            action={{ to: '/games', label: 'Browse all' }}
                        />
                        <JustOutRail games={justOut} today={today} />
                    </section>
                )}

                {/* Last: news is about Steam's most-played games alone, which the panels above are not. */}
                {news.length > 0 && (
                    <section className="pt-16 sm:pt-20" aria-labelledby="news-heading">
                        <HomeSectionHeading
                            id="news-heading"
                            title="Latest news"
                            subtitle="Patch notes and announcements from the games most played on Steam"
                            // The same rail for everybody, so the way to one's own news is a link
                            // rather than a second rail. Shown once auth has answered, as the
                            // navbar's link to the same page is.
                            action={!loading && user !== null ? { to: '/news', label: 'News for your games' } : undefined}
                        />

                        {/* A front page: the newest item as the lead, and the rest as a column of briefs
                            beside it, or under it on a phone. minmax(0, …) rather than an implicit
                            column, which sizes to its content: a brief's source line counts at full
                            length, wider than a phone. */}
                        <div className="grid gap-x-14 gap-y-8 grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
                            <NewsCard item={news[0]} variant="lead" />
                            {news.length > 1 && (
                                <ul className="border-t border-line" aria-label="More news">
                                    {news.slice(1).map(item => (
                                        <li key={item.id}><NewsCard item={item} variant="brief" /></li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
}

export default HomePage;
