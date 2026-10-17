'use strict';

/**
 * Lighthouse CI's puppeteer script (ADR 0068). LHCI runs it once before each URL's runs, in the
 * browser Lighthouse then audits in, so a cookie set here is the session every run of that URL has.
 * CommonJS because LHCI loads it with `require`.
 *
 * A URL in `LIGHTHOUSE_SIGNED_IN` gets the run's throwaway account signed in, through the endpoint
 * the sign-in dialog calls and with the header `apiFetch` adds to every write. Every other URL gets no
 * session at all: the cookies are cleared first, so a signed-out page is what a stranger is served
 * whichever page was audited before it.
 *
 * @param {import('puppeteer-core').Browser} browser
 * @param {{ url: string }} context
 */
module.exports = async function signIn(browser, { url }) {
    const signedIn = JSON.parse(process.env.LIGHTHOUSE_SIGNED_IN ?? '[]').includes(url);
    const page = await browser.newPage();

    try {
        // Somewhere on the site to send the request from: a page, whose content policy lets its
        // scripts call the API as every page's do. Not robots.txt or another resource route, which
        // carry the API's own policy and refuse any request made from them (ADR 0053 §4). The terms
        // are the plainest page there is.
        await page.goto(new URL('/terms', url).href);

        const session = await page.createCDPSession();
        await session.send('Network.clearBrowserCookies');
        if (!signedIn) return;

        const status = await page.evaluate(async credentials => {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-MVGL-Request': '1' },
                body: JSON.stringify(credentials),
            });
            return response.status;
        }, { email: process.env.LIGHTHOUSE_EMAIL, password: process.env.LIGHTHOUSE_PASSWORD });

        if (status !== 200) throw new Error(`Signing in before auditing ${url} was answered ${status}.`);
    } finally {
        await page.close();
    }
};
