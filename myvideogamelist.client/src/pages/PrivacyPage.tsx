import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { CACHE_STATIC_PAGE } from '@/lib/cache';
import { DISCORD_INVITE_URL, SUPPORT_EMAIL } from '@/lib/links';
import { pageMeta, siteConfig } from '@/lib/seo';
import type { Route } from './+types/PrivacyPage';

/** When the policy last changed. Change it with the words: it is how a reader tells that they moved. */
const UPDATED = '12 November 2026';

const H2 = 'type-title text-xl text-fg-strong mt-10 mb-3';
const P = 'text-fg-soft leading-relaxed mb-3';
const LIST = 'list-disc pl-5 space-y-1.5 text-fg-soft leading-relaxed mb-3';
const LINK = 'text-link';
const NAME = 'font-mono text-fg break-words';

/** Where a reader writes about their data. Said five times, so written once. */
const CONTACT = <a href={`mailto:${SUPPORT_EMAIL}`} className={LINK}>{SUPPORT_EMAIL}</a>;

export function loader() {
    return { site: siteConfig() };
}

export function headers() {
    return { 'Cache-Control': CACHE_STATIC_PAGE };
}

export function meta({ loaderData }: Route.MetaArgs) {
    return pageMeta({
        site: loaderData.site,
        title: 'Privacy policy - MyVideoGameList',
        description: 'What MyVideoGameList keeps about you, why, for how long and who else sees it, in plain words: your account, what you share, the two cookies, and your rights.',
        path: '/privacy',
    });
}

/**
 * The privacy policy, in plain words (issue 141). Linked from the footer on every page, beside the terms.
 *
 * Every sentence is a claim about what the code does, so a change to what the site keeps, shows,
 * loads or sends changes this page too, and its date. What it rests on: the account's columns and the
 * export manifest (ADR 0024), the import's retention windows (ADR 0038), the request log's line (ADR
 * 0059), the two cookies (`SignedInFlag`, ADR 0074), the look's copy in the browser (ADR 0082), the
 * image hosts in `IMAGE_SOURCES` (ADR 0056), the trailer loaded on request (`TrailerPlayer`), the two
 * emails and what a bounce does (ADR 0088 to 0091), the sign-up check (ADR 0092), a profile private by
 * default (ADR 0025), and the log groups' and backups' retention in `infra/`.
 *
 * Two parts have an end. *Before launch* is the trial's promise, and goes once its accounts have moved.
 * And it says a search is in the request log, because `react-router-serve` logs every page's whole URL,
 * which ADR 0059 meant never to happen: issue 407 takes the query string out, and that sentence with it.
 */
export default function PrivacyPage() {
    return (
        <>
            <PageHeader title="Privacy policy" description={`What MyVideoGameList keeps about you, why, and who else sees it, in plain words. Last updated ${UPDATED}.`} width="4xl" />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="max-w-3xl">
                    <p className={P}>
                        This page says what MyVideoGameList keeps about you, why it keeps it and for how long, who
                        else handles it, and what you can do about it. It goes with our{' '}
                        <Link to="/terms" className={LINK}>terms of use</Link>, and like them it is short on purpose.
                        We keep only what the site needs to do what you use it for. We sell none of it, we show no
                        ads, and we use no analytics.
                    </p>

                    <h2 className={H2}>Who we are</h2>
                    <p className={P}>
                        &ldquo;We&rdquo; on this page means Stamen Stoychev, who runs MyVideoGameList and decides
                        what happens to the data described here. In data protection law, that makes us its
                        controller.
                    </p>
                    <p className={P}>
                        To ask about your data, or to use any of the rights below, write to {CONTACT}.
                    </p>

                    <h2 className={H2}>Before launch</h2>
                    <p className={P}>
                        Until MyVideoGameList launches at myvideogamelist.net, it runs as a trial at
                        dev.myvideogamelist.net. If you have an account on the trial, it moves to
                        myvideogamelist.net at launch, whole: your lists and everything else this page describes,
                        with your password and your confirmed email address, so you sign in with the same ones.
                        You will have to sign in again, because no session moves with it. Once the move is done,
                        the trial&rsquo;s copy is deleted. If you would rather your account did not move, delete it
                        before launch.
                    </p>

                    <h2 className={H2}>Your account</h2>
                    <p className={P}>
                        You need an email address and a password to have an account. Everything else is up to you.
                        For an account we keep:
                    </p>
                    <ul className={LIST}>
                        <li>
                            your email address, which you sign in with and which we send the two emails below to.
                            Nobody else sees it. It cannot be changed on the site yet: write to us and we will
                            change it;
                        </li>
                        <li>your username, which is public once your profile is;</li>
                        <li>your password, only as a salted hash, from which nobody can read it back;</li>
                        <li>
                            when you created the account, and the last day you visited while signed in, which is
                            written at most once a day. We use both only to count members, such as how many join
                            each week and how many visit, and never to look at one account;
                        </li>
                        <li>
                            how many wrong passwords have been tried in a row, so that five lock the account for
                            fifteen minutes. The count goes back to nothing when you sign in;
                        </li>
                        <li>
                            when you last reset your password, because a reset signs you out everywhere and this
                            is how every other browser learns of it;
                        </li>
                        <li>a display name, the address of a picture and a bio, if you give your profile them;</li>
                        <li>
                            your settings: whether your profile is public, the look you chose for the site, and how
                            your lists are laid out, sorted and named.
                        </li>
                    </ul>

                    <h2 className={H2}>The email we send</h2>
                    <p className={P}>
                        Only two kinds, both about your account, from noreply@myvideogamelist.net: a link to
                        confirm your address when you sign up, which you need before you can sign in and which
                        works for a day, and a link to reset your password when you ask for one, which works once,
                        for an hour. No newsletters and nothing else.
                    </p>
                    <p className={P}>
                        They go through Amazon&rsquo;s email service. If an email to you bounces, or you mark one as
                        spam, Amazon stops sending to your address and tells us which address it was and why, so
                        that we can help when you write to us.
                    </p>

                    <h2 className={H2}>What you track</h2>
                    <p className={P}>
                        Your lists and everything in them: the games and the list each is in, every move between
                        lists and when it happened, your scores and when you gave them, your notes, the copies you
                        own, your tags, your playthroughs with their dates, hours and platform, your reviews, your
                        wishlist, your favourites, and the order you arrange games in. This is what the site is
                        for: we keep it to show it to you, and to show what you choose to share.
                    </p>
                    <p className={P}>
                        When you bring your library over from another tracker, we read the file you upload and do
                        not keep it. We keep each game it lists until you finish or cancel the import, and after
                        that only a receipt, the file&rsquo;s name and how many games were imported and skipped,
                        for seven days. An import you leave unfinished is deleted fourteen days after you last
                        changed it.
                    </p>

                    <h2 className={H2}>What other people see</h2>
                    <p className={P}>
                        Your profile is private until you make it public, and each review is private until you mark
                        it public. Until then nobody else sees anything you have entered, except as part of the
                        figures each game shows, which name nobody.
                    </p>
                    <ul className={LIST}>
                        <li>
                            <strong className="text-fg">A public profile</strong> shows your username, display name,
                            picture and bio; figures about your library, such as how many games are in each list,
                            how you score them and how many you start and finish each month; your favourites; the
                            reviews you have marked public, with your score for each game; and how many games are on
                            your wishlist, but not which. It never shows your email address, which games are in
                            which list, your notes, your tags or the copies you own.
                        </li>
                        <li>
                            <strong className="text-fg">Search engines</strong> may list a public profile that has
                            something in it, because our sitemap names it. When you make your profile private, rename
                            it or delete your account, the site stops showing it at once and we tell our content
                            delivery network to drop its copies. A search engine&rsquo;s copy is out of our hands
                            until the search engine next visits.
                        </li>
                        <li>
                            <strong className="text-fg">Each game&rsquo;s figures</strong>, such as its member score
                            and its completion times, count every member&rsquo;s scores and timed playthroughs,
                            whether their profile is public or not, and never with a name. A figure is shown only
                            once enough members are behind it.
                        </li>
                        <li>
                            <strong className="text-fg">A review</strong> appears on its game&rsquo;s page only while
                            both the review and your profile are public.
                        </li>
                    </ul>

                    <h2 className={H2}>What a visit leaves behind</h2>
                    <p className={P}>
                        Every request reaches us through Amazon&rsquo;s CloudFront network and a load balancer,
                        which need your IP address to answer you. We have not switched on their access logs, so
                        neither keeps a record of it for us.
                    </p>
                    <p className={P}>
                        Our own servers write one line for each request: the address that was asked for, the
                        answer and how long it took. Never your IP address, a cookie or any other header. Because a
                        line holds the address, it can hold a username, when the page was somebody&rsquo;s profile,
                        and the words you searched for, when a search took you to the games page. A profile made
                        private, renamed or deleted leaves a line naming it too, which is how we check that our
                        network dropped its copies, and an email we send leaves a line saying which kind it was,
                        never the address. We keep these lines for two weeks, to find out what went wrong when
                        something does.
                    </p>
                    <p className={P}>
                        To slow down anybody guessing passwords or sending email to other people&rsquo;s addresses,
                        signing in, signing up and asking for either email are limited to ten attempts from one IP
                        address every five minutes. That count is held in our server&rsquo;s memory for those five
                        minutes and never written down.
                    </p>

                    <h2 className={H2}>Cookies, and what else is kept in your browser</h2>
                    <p className={P}>
                        MyVideoGameList sets two cookies, and only when you sign in. Both are strictly necessary for
                        what you asked for, being signed in, so the law does not require us to ask first, and there
                        is no cookie banner.
                    </p>
                    <ul className={LIST}>
                        <li>
                            <code className={NAME}>.AspNetCore.Identity.Application</code> keeps you signed in. It is
                            encrypted, so only our server can read it; the page&rsquo;s scripts cannot reach it; and
                            it is only ever sent over HTTPS. It lasts until you close your browser, or for thirty
                            days, renewed while you use the site, if you tick{' '}
                            <strong className="text-fg">Remember me</strong>. Signing out removes it.
                        </li>
                        <li>
                            <code className={NAME}>mvgl_signed_in</code> says that this browser is signed in, and
                            nothing about who: its value is always <code className={NAME}>1</code>. It lets our
                            content delivery network keep two copies of the home page, one for visitors and one for
                            members, so that yours is right from the start. It lasts as long as the first cookie and
                            goes when it does.
                        </li>
                    </ul>
                    <p className={P}>
                        One more thing is kept in your browser&rsquo;s storage, as{' '}
                        <code className={NAME}>mvgl-look</code>: a copy of the look you chose for the site, its
                        colours and its pattern, so that each page is drawn in it from the start. It says nothing
                        about who you are. It stays when you sign out, so the browser keeps its last look, and goes
                        when you delete your account.
                    </p>
                    <p className={P}>
                        The site keeps nothing else in your browser: no analytics and no advertising. Another site
                        can keep something only once you open the sign-up form or play a trailer, both below. If we
                        ever want a cookie that is not strictly necessary, we will ask you first, and say so here.
                    </p>

                    <h2 className={H2}>What your browser loads from other sites</h2>
                    <ul className={LIST}>
                        <li>
                            <strong className="text-fg">Game art</strong> comes from IGDB&rsquo;s image server,{' '}
                            <code className={NAME}>images.igdb.com</code>. Your browser asks it directly, so it sees
                            your IP address. It is told that the request comes from MyVideoGameList, but not from
                            which page.
                        </li>
                        <li>
                            <strong className="text-fg">Members&rsquo; pictures</strong> come from the host each
                            member chose: Gravatar, GitHub, Steam or Imgur. Your browser asks without cookies and
                            without saying which page it is on, but the host still sees your IP address.
                        </li>
                        <li>
                            <strong className="text-fg">The sign-up form</strong> uses Cloudflare&rsquo;s Turnstile to
                            check that a person is signing up. When you open the form, your browser loads
                            Turnstile&rsquo;s script and its check from{' '}
                            <code className={NAME}>challenges.cloudflare.com</code>, so Cloudflare sees your IP
                            address, and Cloudflare&rsquo;s privacy policy covers what the check does. No page
                            contacts Cloudflare until the form is opened.
                        </li>
                        <li>
                            <strong className="text-fg">Trailers</strong> come from YouTube, and nothing is asked of
                            YouTube until you press <strong className="text-fg">Play trailer</strong>. Then its
                            player loads from <code className={NAME}>youtube-nocookie.com</code>, and Google&rsquo;s
                            privacy policy covers what it does.
                        </li>
                        <li>
                            <strong className="text-fg">Everything else</strong>, the pages, their scripts and their
                            fonts, comes from our own servers. Apart from Turnstile&rsquo;s, no page runs a script from
                            another site.
                        </li>
                    </ul>
                    <p className={P}>
                        Links to other sites, such as stores, Steam&rsquo;s news and our Discord server, lead to
                        services with privacy policies of their own.
                    </p>

                    <h2 className={H2}>What our servers ask other services</h2>
                    <p className={P}>
                        Game details come from IGDB, and news from Steam. Our servers ask them, not your browser,
                        and send nothing about you:
                    </p>
                    <ul className={LIST}>
                        <li>
                            when you search for a game, the words you type go to IGDB from our servers, with nothing
                            to say who typed them;
                        </li>
                        <li>when an import cannot match a title by itself, the title goes to IGDB the same way;</li>
                        <li>Twitch, which runs IGDB, issues the key our servers ask it with, and learns nothing about you from it;</li>
                        <li>Steam is asked for news by game, never by person.</li>
                    </ul>
                    <p className={P}>
                        When you sign up, our server asks Cloudflare whether the form&rsquo;s check was passed,
                        sending it the check&rsquo;s answer and your IP address, which Cloudflare has already from
                        loading the check. Nothing else about you goes with it.
                    </p>

                    <h2 className={H2}>Who handles your data for us</h2>
                    <ul className={LIST}>
                        <li>
                            <strong className="text-fg">Amazon Web Services</strong> runs all of the above for us: the
                            servers, the database, the logs, the backups and the email, in its Frankfurt region, in
                            Germany. Its CloudFront network answers each request from whichever of its locations is
                            nearest you, which may be outside the EU. AWS handles the data on our instructions and
                            for no purpose of its own, under its data processing terms, which also cover data that
                            leaves the EU.
                        </li>
                        <li>
                            <strong className="text-fg">Cloudflare</strong> checks that a sign-up comes from a
                            person, as above.
                        </li>
                        <li>
                            <strong className="text-fg">Google</strong> runs the mailbox at {CONTACT}, so an email
                            you send us is kept there.
                        </li>
                    </ul>
                    <p className={P}>Nobody else handles your data for us.</p>

                    <h2 className={H2}>Why we are allowed to</h2>
                    <ul className={LIST}>
                        <li>
                            <strong className="text-fg">To give you the service you signed up for</strong>: your
                            account and the two emails it needs, your lists, your imports and, once you publish it,
                            your profile. The law calls this a contract.
                        </li>
                        <li>
                            <strong className="text-fg">Because we have a legitimate interest</strong> in keeping the
                            site safe and working, and in knowing roughly how many people use it: the check on
                            sign-ups, the request log, the limits on signing in, the backups, the last day you
                            visited, and the figures each game shows.
                        </li>
                    </ul>
                    <p className={P}>We do not profile you, and no decision about you is made automatically.</p>

                    <h2 className={H2}>How long we keep it</h2>
                    <ul className={LIST}>
                        <li>Your account and everything in it: until you delete it, or we do under the terms.</li>
                        <li>The database&rsquo;s backups: seven days, so what is deleted is gone from them a week later.</li>
                        <li>
                            An import: until you finish or cancel it, then its receipt for seven days; an unfinished
                            one for fourteen days after you last changed it.
                        </li>
                        <li>The line each request leaves: two weeks.</li>
                        <li>The count of attempts to sign in: five minutes, in memory.</li>
                        <li>The cookies: as long as you stay signed in, as above.</li>
                        <li>The copy of your look in your browser: until you delete your account, or clear it.</li>
                        <li>An email you send us: as long as we need it to answer you.</li>
                    </ul>

                    <h2 className={H2}>Your rights</h2>
                    <p className={P}>
                        You can do most of this yourself, under{' '}
                        <Link to="/user/settings#your-data" className={LINK}>Your data in your settings</Link>, at
                        any time and for free:
                    </p>
                    <ul className={LIST}>
                        <li>
                            <strong className="text-fg">take a copy</strong> of everything you have entered with{' '}
                            <strong className="text-fg">Download my data</strong>: one file, in JSON, which any
                            program can read;
                        </li>
                        <li>
                            <strong className="text-fg">correct it</strong> where you entered it. Your email address
                            is the exception for now: write to us;
                        </li>
                        <li>
                            <strong className="text-fg">delete it</strong> with{' '}
                            <strong className="text-fg">Delete my account</strong>, which deletes the account and
                            everything in it at once and for good. It is gone from our backups seven days later;
                        </li>
                        <li>
                            <strong className="text-fg">decide who sees it</strong>: your profile and your reviews
                            stay private until you publish them, and you can make them private again whenever you
                            like.
                        </li>
                    </ul>
                    <p className={P}>
                        You also have the right to ask what we hold about you and what we do with it, to object to
                        it, or to ask us to stop for a while. Write to {CONTACT}, and we will answer within a month.
                    </p>
                    <p className={P}>
                        If you think we have got something wrong, you can complain to a data protection authority:
                        ours is Bulgaria&rsquo;s{' '}
                        <a href="https://cpdp.bg/en/" target="_blank" rel="noopener noreferrer" className={LINK}>
                            Commission for Personal Data Protection
                            <span className="sr-only"> (opens in a new tab)</span>
                        </a>, or you can go to the one where you live.
                    </p>

                    <h2 className={H2}>Children</h2>
                    <p className={P}>
                        You need to be at least 13 years old to have an account, or older if the law where you live
                        requires it, as the terms say. If you believe a younger child has an account, write to{' '}
                        {CONTACT} and we will delete it.
                    </p>

                    <h2 className={H2}>Changes to this policy</h2>
                    <p className={P}>
                        When the site starts keeping something new, or uses what it keeps differently, this policy
                        changes with it, and so does the date at the top. When a change matters, we will say so on
                        the site.
                    </p>

                    <h2 className={H2}>Questions</h2>
                    <p className={P}>
                        About your data, write to {CONTACT}. About anything else, ask us on{' '}
                        <a href={DISCORD_INVITE_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
                            our Discord server
                            {/* The space inside the hidden text: before it, it would be an
                                underlined gap ahead of the full stop. */}
                            <span className="sr-only"> (opens in a new tab)</span>
                        </a>.
                    </p>
                </div>
            </div>
        </>
    );
}
