import { Link, data } from 'react-router';
import { useAuth } from '@/hooks/useAuth';
import { ComingSoonRail } from '@/components/ComingSoonRail';
import { ContinuePlayingRail } from '@/components/ContinuePlayingRail';
import { HomeSectionHeading } from '@/components/HomeSectionHeading';
import { HomeStatsStrip } from '@/components/HomeStatsStrip';
import { PlayNextPicker } from '@/components/PlayNextPicker';
import { ReleaseLine } from '@/components/ReleaseLine';
import { ShowcasesAndSales } from '@/components/ShowcasesAndSales';
import { JustOutRail } from '@/components/JustOutRail';
import { WelcomePanel } from '@/components/WelcomePanel';
import { NewsCard } from '@/components/NewsCard';
import { CACHE_HOME, PRIVATE_NO_STORE } from '@/lib/cache';
import { utcDay } from '@/lib/daySpan';
import { type SiteConfig, pageMeta, siteConfig } from '@/lib/seo';
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
export async function loader({ context }: Route.LoaderArgs) {
    const site = siteConfig();
    const today = utcDay(new Date());

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
                degraded, site, today,
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
 * Rendered only after hydration, and unavoidably so: this page is shared-cached, the server render
 * has no cookie, and `AuthProvider` learns who the user is from a fetch. So a signed-in visitor
 * sees the welcome panel for the length of one request and then this. Fixing that properly means a
 * cookie-varying SSR render and a CloudFront behaviour to match, which is ROADMAP D12's problem
 * rather than this component's.
 */
function SignedInHero({ user }: { user: UserProfile }) {
    return (
        <section className="signed-in-hero">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
                <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
                    <div>
                        <h1 className="text-2xl sm:text-3xl font-bold text-fg-strong">
                            Welcome back, {user.userName}
                        </h1>
                        <p className="text-sm text-fg-muted mt-1">
                            Pick up where you left off.
                        </p>
                    </div>

                    <Link
                        to="/lists"
                        className="shrink-0 text-sm font-medium text-primary-400 hover:text-primary-300 transition-colors"
                    >
                        All your lists <span aria-hidden="true">→</span>
                    </Link>
                </div>

                <HomeStatsStrip userId={user.id} />

                <h2 className="text-lg font-semibold text-fg-strong mt-8 mb-4">
                    Continue playing
                </h2>
                <ContinuePlayingRail />

                {/* After the rail rather than before it: what you are playing, then what to play
                    once that is done. Starting the pick moves it into the rail above. */}
                <h2 className="text-lg font-semibold text-fg-strong mt-8 mb-4">
                    Play next
                </h2>
                <PlayNextPicker />

                {/* Last in the hero, so directly above the panels everybody sees, which matter less to
                    somebody signed in than their own games do (L1). Brings its own heading, because
                    its sentence for an empty two weeks belongs inside the line it describes. */}
                <ReleaseLine userId={user.id} />
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
    const { news, events = NO_EVENTS, comingSoon = [], justOut = [], today } = loaderData;
    const { user, loading } = useAuth();
    const signedIn = user !== null && !loading;

    return (
        <div className="min-h-screen">
            {/* The welcome panel while auth is still unknown, which includes every server render.
                The alternative — nothing until `me` answers — flashes an empty page at the one
                visitor the panel is written for. */}
            {signedIn
                ? <SignedInHero user={user} />
                : <WelcomePanel />}

            {/* Everything below is the same for both, but for the showcases and sales, which give
                way to the line. The panels and the news are worth seeing whether or not anybody is
                signed in, and duplicating them into two branches is how the two drift. A rule
                between each section and the next, whichever of them are drawn: any of them can be
                missing. */}
            <div className="max-w-6xl mx-auto px-4 sm:px-6 divide-y divide-line">
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
                    <section className="py-10 sm:py-12" aria-labelledby="coming-soon-heading">
                        <HomeSectionHeading
                            id="coming-soon-heading"
                            title="Coming soon"
                            subtitle="The new games most followed on IGDB, out in the next three months"
                        />
                        <ComingSoonRail games={comingSoon} today={today} />
                    </section>
                )}

                {justOut.length > 0 && (
                    <section className="py-10 sm:py-12" aria-labelledby="just-out-heading">
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
                    <section className="py-10 sm:py-12" aria-labelledby="news-heading">
                        <HomeSectionHeading
                            id="news-heading"
                            title="Latest news"
                            subtitle="Patch notes and announcements from the games most played on Steam"
                            // The same rail for everybody, so the way to one's own news is a link
                            // rather than a second rail. Shown once auth has answered, as the
                            // navbar's link to the same page is.
                            action={signedIn ? { to: '/news', label: 'News for your games' } : undefined}
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
        </div>
    );
}

export default HomePage;
