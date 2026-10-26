import { Link } from 'react-router';
import { PageHeader } from '@/components/PageHeader';
import { CACHE_STATIC_PAGE } from '@/lib/cache';
import { DISCORD_INVITE_URL } from '@/lib/links';
import { pageMeta, siteConfig } from '@/lib/seo';
import type { Route } from './+types/TermsPage';

/** When the terms last changed. Change it with them: it is how a reader tells that they moved. */
const UPDATED = '13 October 2026';

const H2 = 'type-title text-xl text-fg-strong mt-10 mb-3';
const P = 'text-fg-soft leading-relaxed mb-3';
const LIST = 'list-disc pl-5 space-y-1.5 text-fg-soft leading-relaxed mb-3';
const LINK = 'text-primary-400 hover:text-primary-300 underline underline-offset-2';

export function loader() {
    return { site: siteConfig() };
}

export function headers() {
    return { 'Cache-Control': CACHE_STATIC_PAGE };
}

export function meta({ loaderData }: Route.MetaArgs) {
    return pageMeta({
        site: loaderData.site,
        title: 'Terms of use - MyVideoGameList',
        description: 'The rules for using MyVideoGameList, in plain words: your account, what you post, your data and how to keep a copy, and what we can and cannot promise.',
        path: '/terms',
    });
}

/**
 * The terms of use, in plain words (issue 141). Linked from the footer on every page.
 *
 * What they say about who sees what has to stay true to the site: a profile is private until its owner
 * publishes it (ADR 0025), an aggregate counts every member and names none (ADR 0028), notes are seen
 * by nobody else, and the export is free (ADR 0024). Change the date above with the words.
 */
export default function TermsPage() {
    return (
        <>
            <PageHeader title="Terms of use" description={`The rules for using MyVideoGameList, in plain words. Last updated ${UPDATED}.`} width="4xl" />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="max-w-3xl">
                    <p className={P}>
                        MyVideoGameList is a place to keep track of the games you play. These terms are the rules
                        for using it. By creating an account or using the site you agree to them, so please read
                        them: they are short on purpose.
                    </p>

                    <h2 className={H2}>The service</h2>
                    <p className={P}>
                        MyVideoGameList is free to use, and it is provided as it is and as available. We may change
                        what it does, add features, take some away or stop running it, and some features may become
                        part of a paid plan. If we ever charge for something, its price and terms are shown before
                        you pay.
                    </p>

                    <h2 className={H2}>Your account</h2>
                    <p className={P}>
                        You sign in with your email address or your username, and a password. Keep the password to
                        yourself: you are responsible for what is done with your account. You need to be at least 13
                        years old to have one, or older if the law where you live requires it.
                    </p>
                    <p className={P}>
                        Your username is how other people see you once you publish your profile, and the address of
                        that profile. A display name, a picture and a bio, if you give your profile them, are shown
                        beside it. Until then the site shows none of these to anybody else. Don&rsquo;t choose a
                        name or a picture that pretends to be somebody else or that is offensive; we may suspend an
                        account that does.
                    </p>

                    <h2 className={H2}>What you put on the site</h2>
                    <p className={P}>
                        Your lists, scores, notes, playthroughs, reviews and what you write about yourself are
                        yours. You let us store them, and show them the way the site&rsquo;s settings say:
                    </p>
                    <ul className={LIST}>
                        <li>
                            your profile, with your display name, picture and bio, your tracking, your favourites
                            and the reviews you mark public, only once you make it public;
                        </li>
                        <li>
                            your scores and playthrough times, without your name, in the figures each game shows,
                            such as its member score and its completion times;
                        </li>
                        <li>your notes to nobody but you.</li>
                    </ul>
                    <p className={P}>
                        Don&rsquo;t post anything illegal, hateful or harassing, anything you have no right to post,
                        or spam. We may remove what breaks these rules, and suspend the account that posted it.
                    </p>

                    <h2 className={H2}>Your data, and keeping a copy</h2>
                    <p className={P}>
                        We look after your data, but we cannot promise that it will never be lost, damaged or out of
                        reach for a while: servers fail, and so do the people who run them. MyVideoGameList is not a
                        backup service.
                    </p>
                    <p className={P}>
                        You can download everything you have entered, at any time and for free, with
                        {' '}<strong className="text-fg">Download my data</strong> on{' '}
                        <Link to="/user" className={LINK}>your profile page</Link>. If your lists matter to you,
                        keep a copy of your own.
                    </p>
                    <p className={P}>
                        As far as the law allows, we are not responsible for data that is lost, or for anything
                        that follows from losing it.
                    </p>

                    <h2 className={H2}>Game information, and other sites</h2>
                    <p className={P}>
                        Game details come from IGDB.com, and news from Steam. We show them as we receive them and
                        cannot promise that they are complete, correct or up to date. MyVideoGameList is not
                        affiliated with or endorsed by Valve.
                    </p>
                    <p className={P}>
                        Links to other sites, such as stores, news articles and our Discord server, lead to services
                        with terms of their own, which we don&rsquo;t control.
                    </p>

                    <h2 className={H2}>Using the site fairly</h2>
                    <p className={P}>
                        Use the site as a person would. Don&rsquo;t try to break it, overload it or get around its
                        security, don&rsquo;t copy its contents in bulk with automated tools, and don&rsquo;t use it
                        to harass anybody.
                    </p>

                    <h2 className={H2}>Ending things</h2>
                    <p className={P}>
                        You can delete your account at any time with <strong className="text-fg">Delete my
                        account</strong> on your profile page. That deletes everything in it for good, so download
                        your data first if you want to keep it.
                    </p>
                    <p className={P}>
                        We may suspend or delete an account that breaks these terms. If we ever close the site, we
                        will try to say so beforehand, so that you can download your data.
                    </p>

                    <h2 className={H2}>No guarantees</h2>
                    <p className={P}>
                        As far as the law allows, the site comes with no promise that it is free of errors or always
                        available, and we are not liable for any indirect or consequential loss, or for any loss of
                        data, profit or goodwill, that comes from using it or from being unable to.
                    </p>
                    <p className={P}>
                        Nothing in these terms limits a liability that the law does not allow to be limited, or takes
                        away a right you have by law as a consumer.
                    </p>

                    <h2 className={H2}>Changes to these terms</h2>
                    <p className={P}>
                        We may change these terms. When we do, the date at the top changes, and when a change matters
                        we will say so on the site. Using the site after a change means you accept the new terms.
                    </p>

                    <h2 className={H2}>Questions</h2>
                    <p className={P}>
                        Ask us on{' '}
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
