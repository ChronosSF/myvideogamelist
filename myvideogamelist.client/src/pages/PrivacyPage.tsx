import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { CACHE_STATIC_PAGE } from '@/lib/cache';
import { DISCORD_INVITE_URL, SUPPORT_EMAIL } from '@/lib/links';
import { pageMeta, siteConfig } from '@/lib/seo';
import type { Route } from './+types/PrivacyPage';

/** When the policy last changed. Change it with the words: it is how a reader tells that they moved. */
const UPDATED = '15 November 2026';

const H2 = 'type-title text-xl text-fg-strong mt-10 mb-3';
const P = 'text-fg-soft leading-relaxed mb-3';
const LIST = 'list-disc pl-5 space-y-1.5 text-fg-soft leading-relaxed mb-3';
const LINK = 'text-link';
const NAME = 'font-mono text-fg break-words';
const LEAD = 'text-fg';

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
        description: 'What MyVideoGameList keeps about you, why, who else sees it and what you can do about it, in plain words.',
        path: '/privacy',
    });
}

/**
 * The privacy policy, in plain words (issue 141). Linked from the footer on every page, beside the terms.
 *
 * Written for a reader rather than an auditor: what is kept, who sees it, for how long and what they can
 * do, with the mechanism left out unless a reader would act on it. The cookie names stay, because a
 * cookie note names its cookies. Every sentence is still a claim about the code, so a change to what
 * the site keeps, shows, loads or sends changes this page too, and its date. What it rests on: the
 * account's columns and the export manifest (ADR 0024), the import's retention windows (ADR 0038), the
 * request log's line (ADR 0059, and the SSR server's in ADR 0093), the two cookies (`SignedInFlag`, ADR
 * 0074), the look's copy in the browser (ADR 0082), the image hosts in `IMAGE_SOURCES` (ADR 0056), the
 * trailer loaded on request (`TrailerPlayer`), the two emails and what a bounce does (ADR 0088 to 0091),
 * the sign-up check (ADR 0092), reports and what an admin may withdraw (ADR 0076), the community floors
 * (ADR 0094), a profile private by default (ADR 0025), and the log groups' and backups' retention in
 * `infra/`.
 *
 * *If you joined during the trial* is the trial's promise, and goes once its accounts have moved.
 */
export default function PrivacyPage() {
    return (
        <>
            <PageHeader title="Privacy policy" description={`What we keep about you, why, and who else sees it. Last updated ${UPDATED}.`} width="4xl" />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="max-w-3xl">
                    <p className={P}>
                        This page explains what MyVideoGameList keeps about you, why, who else sees it, and what you
                        can do about it. It goes with our <Link to="/terms" className={LINK}>terms of use</Link>.
                    </p>

                    <h2 className={H2}>In short</h2>
                    <ul className={LIST}>
                        <li>We keep only what the site needs: your account, your lists, and a little to keep it safe.</li>
                        <li>We don&rsquo;t sell your data, show ads or use analytics.</li>
                        <li>Your profile and your reviews are private until you make them public.</li>
                        <li>You can download everything you have entered, or delete your account, at any time.</li>
                        <li>Our cookies only keep you signed in.</li>
                        <li>Questions about your data go to {CONTACT}.</li>
                    </ul>

                    <h2 className={H2}>Who we are</h2>
                    <p className={P}>
                        MyVideoGameList is run by Stamen Stoychev, who decides what happens to your data: the
                        &ldquo;controller&rdquo;, in data protection law. To ask about anything on this page, or to
                        use your rights, write to {CONTACT}.
                    </p>

                    <h2 className={H2}>If you joined during the trial</h2>
                    <p className={P}>
                        Until it launches, MyVideoGameList runs as a trial at dev.myvideogamelist.net. If you have an
                        account there, it moves to myvideogamelist.net at launch with everything in it, and you sign
                        in with the same email address and password. Once it has moved, the trial&rsquo;s copy is
                        deleted. If you would rather not move, delete your account before launch.
                    </p>

                    <h2 className={H2}>What we keep</h2>
                    <p className={P}>
                        <strong className={LEAD}>Your account.</strong> Your email address and a password, which
                        every account needs, and your username. Anything you add to your profile: a display name, a
                        link to a picture and a bio. Your password is stored scrambled, so that nobody can read it,
                        us included. We also note when you joined, the last day you visited, wrong passwords tried
                        in a row, and when you last reset your password. We use the dates only to count how many
                        people join and visit, never to look at one person.
                    </p>
                    <p className={P}>
                        <strong className={LEAD}>Your lists.</strong> Everything you track: your games and lists,
                        scores, notes, playthroughs, reviews, tags, wishlist and favourites, and your settings.
                    </p>
                    <p className={P}>
                        <strong className={LEAD}>Imports.</strong> When you import a file, we read it and don&rsquo;t
                        keep the file. We keep the games from it until you finish or cancel the import, then a short
                        receipt (the file&rsquo;s name and how many games came in) for seven days. An import you
                        leave unfinished is deleted after fourteen days without changes.
                    </p>
                    <p className={P}>
                        <strong className={LEAD}>Reports.</strong> If you report a review or a profile, we keep your
                        reason and note until an admin deals with it, then delete it. Admins never see who sent a
                        report.
                    </p>

                    <h2 className={H2}>Email</h2>
                    <p className={P}>
                        We only email you about your account: a link to confirm your address when you sign up, and a
                        link to reset your password when you ask for one. No newsletters. If an email to you bounces
                        or is marked as spam, no more email goes to that address, and we are told which address it
                        was so that we can help if you get in touch.
                    </p>

                    <h2 className={H2}>Who can see what</h2>
                    <ul className={LIST}>
                        <li>
                            <strong className={LEAD}>Nobody, until you choose.</strong> Your profile and your reviews
                            are private until you make them public. Your email address, notes, tags and which copies
                            you own are never shown to anyone.
                        </li>
                        <li>
                            <strong className={LEAD}>A public profile</strong> shows your username, display name,
                            picture and bio, figures about your library, your favourites, your public reviews, and how
                            many games are on your wishlist, but not your lists themselves. Search engines may list
                            it. Make it private again, or delete your account, and it is gone from the site at once;
                            search engines catch up when they next visit.
                        </li>
                        <li>
                            <strong className={LEAD}>Each game&rsquo;s member score and completion times</strong>{' '}
                            include everyone&rsquo;s scores and play times, without names, and only once enough members
                            are behind them.
                        </li>
                        <li>
                            <strong className={LEAD}>Admins</strong> can hide a public review from other readers, or
                            remove a display name, picture or bio, when it is reported and breaks the terms. You still
                            see a hidden review, and can edit or delete it.
                        </li>
                    </ul>

                    <h2 className={H2}>Cookies</h2>
                    <p className={P}>
                        We use two cookies, both only to keep you signed in, so we don&rsquo;t need to ask first and
                        there is no cookie banner:
                    </p>
                    <ul className={LIST}>
                        <li>
                            <code className={NAME}>.AspNetCore.Identity.Application</code> keeps you signed in. It
                            lasts until you close your browser, or for thirty days at a time if you tick{' '}
                            <strong className={LEAD}>Remember me</strong>.
                        </li>
                        <li>
                            <code className={NAME}>mvgl_signed_in</code> tells our servers that this browser is signed
                            in, but not who you are, so that the home page shows the right version.
                        </li>
                    </ul>
                    <p className={P}>
                        Your browser also keeps <code className={NAME}>mvgl-look</code>, your account&rsquo;s colours
                        and background pattern, so that pages appear in them straight away. It stays after you sign
                        out and is removed when you delete your account.
                    </p>
                    <p className={P}>
                        We use no analytics or advertising cookies. If that ever changes, we will ask you first.
                    </p>

                    <h2 className={H2}>Other services we use</h2>
                    <p className={P}>These see some of your data when you use the site, each under its own privacy policy:</p>
                    <ul className={LIST}>
                        <li>
                            <strong className={LEAD}>Amazon Web Services</strong> hosts everything: our servers, the
                            database, backups and email, in Frankfurt, Germany. It may serve pages from a location near
                            you, which can be outside the EU. AWS handles your data only on our behalf, under terms
                            that also cover data leaving the EU.
                        </li>
                        <li>
                            <strong className={LEAD}>IGDB</strong> provides the game information and cover images. Your
                            browser loads covers from IGDB directly, so IGDB sees your IP address. What you search for,
                            and the titles in an import, go to IGDB from our servers, with nothing that says who you
                            are.
                        </li>
                        <li>
                            <strong className={LEAD}>Cloudflare</strong> checks that sign-ups come from people. Its
                            check loads only when you open the sign-up form, and sees your IP address.
                        </li>
                        <li>
                            <strong className={LEAD}>Google</strong> runs our support mailbox, so emails you send us are
                            kept there.
                        </li>
                        <li>
                            <strong className={LEAD}>Gravatar, GitHub, Steam and Imgur</strong> host the pictures
                            members choose. Your browser loads them without cookies, but the host sees your IP address.
                        </li>
                        <li>
                            <strong className={LEAD}>YouTube</strong> plays trailers, and is contacted only when you
                            press <strong className={LEAD}>Play trailer</strong>.
                        </li>
                        <li>
                            <strong className={LEAD}>Steam</strong> provides game news, and is asked about games, never
                            about you.
                        </li>
                    </ul>
                    <p className={P}>Nobody else receives your data.</p>

                    <h2 className={H2}>Logs and security</h2>
                    <p className={P}>
                        Our servers keep a short log of each request, to find and fix problems: which page was asked
                        for, whether it worked and how long it took. It never includes your IP address, your email
                        address or your cookies, though a page&rsquo;s address can include a username. The log is
                        deleted after two weeks.
                    </p>
                    <p className={P}>
                        To stop password guessing and abuse, we count attempts to sign in, sign up or request an
                        email from each IP address for five minutes, in memory only, and lock an account for fifteen
                        minutes after five wrong passwords.
                    </p>

                    <h2 className={H2}>Why we are allowed to</h2>
                    <ul className={LIST}>
                        <li>
                            <strong className={LEAD}>To provide what you signed up for</strong> (a contract, in the
                            law&rsquo;s words): your account and its emails, your lists, your imports, and your profile
                            once you publish it.
                        </li>
                        <li>
                            <strong className={LEAD}>Our legitimate interest</strong> in keeping the site safe and
                            working, and in knowing roughly how many people use it: the logs, the sign-in limits, the
                            sign-up check, backups, reports, visit counts and the members&rsquo; figures.
                        </li>
                    </ul>
                    <p className={P}>We do not profile you, and no decision about you is made automatically.</p>

                    <h2 className={H2}>How long we keep it</h2>
                    <ul className={LIST}>
                        <li>Your account and everything in it: until you delete it.</li>
                        <li>Backups: seven days.</li>
                        <li>Logs: two weeks.</li>
                        <li>Imports: as described above.</li>
                        <li>Reports: until an admin deals with them.</li>
                        <li>Emails you send us: for as long as we need them to help you.</li>
                    </ul>

                    <h2 className={H2}>Your rights</h2>
                    <p className={P}>
                        You can do most of this yourself under{' '}
                        <Link to="/user/settings#your-data" className={LINK}>Your data in your settings</Link>, for
                        free:
                    </p>
                    <ul className={LIST}>
                        <li>
                            <strong className={LEAD}>Download</strong> everything you have entered, as one file.
                        </li>
                        <li>
                            <strong className={LEAD}>Delete</strong> your account and everything in it, at once and for
                            good. It is gone from our backups seven days later.
                        </li>
                        <li>
                            <strong className={LEAD}>Correct</strong> anything where you entered it. To change your
                            email address, write to us.
                        </li>
                        <li>
                            <strong className={LEAD}>Choose</strong> who sees your profile and your reviews.
                        </li>
                    </ul>
                    <p className={P}>
                        You can also ask us what we hold about you, object to how we use it, or ask us to stop for a
                        while. Write to {CONTACT}, and we will reply within a month. If you are unhappy with how we
                        handle your data, you can complain to Bulgaria&rsquo;s{' '}
                        <a href="https://cpdp.bg/en/" target="_blank" rel="noopener noreferrer" className={LINK}>
                            Commission for Personal Data Protection
                            <span className="sr-only"> (opens in a new tab)</span>
                        </a>, or to the data protection authority where you live.
                    </p>

                    <h2 className={H2}>Children</h2>
                    <p className={P}>
                        You need to be at least 13 to have an account, or older if your country requires it. If you
                        believe a younger child has an account, write to {CONTACT} and we will delete it.
                    </p>

                    <h2 className={H2}>Changes</h2>
                    <p className={P}>
                        When this policy changes, so does the date at the top, and if the change matters we will say
                        so on the site.
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
