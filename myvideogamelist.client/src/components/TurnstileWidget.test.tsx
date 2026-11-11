import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TurnstileApi, TurnstileOptions } from '@/lib/turnstile';
import { empty, json, stubApi, tearDownApi } from '@/test/api';

/**
 * Cloudflare's widget on the sign-up form (ADR 0092), with `window.turnstile` played by the test: jsdom
 * never runs Cloudflare's script, and with the API in place the page loads none. The module is imported
 * afresh for each test, because it keeps the site key for the life of the page.
 */

const drawn: { container: HTMLElement; options: TurnstileOptions }[] = [];
const turnstile: TurnstileApi = {
    render: vi.fn((container: HTMLElement, options: TurnstileOptions) => {
        drawn.push({ container, options });
        return `widget-${drawn.length}`;
    }),
    remove: vi.fn(),
};

async function renderWidget(onToken: (token: string | null) => void) {
    const { TurnstileWidget } = await import('@/components/TurnstileWidget');
    return render(<TurnstileWidget onToken={onToken} />);
}

/** The options the latest widget was drawn with, once it has been. */
async function latest(count = 1) {
    await waitFor(() => expect(drawn).toHaveLength(count));
    return drawn[count - 1].options;
}

beforeEach(() => {
    vi.resetModules();
    drawn.length = 0;
    vi.mocked(turnstile.render).mockClear();
    vi.mocked(turnstile.remove).mockClear();
    window.turnstile = turnstile;
});

afterEach(() => {
    delete window.turnstile;
    tearDownApi();
});

describe('TurnstileWidget', () => {
    it("draws with the deployment's site key, in the site's theme, and hands over the token", async () => {
        const api = stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        const onToken = vi.fn();
        await renderWidget(onToken);

        const options = await latest();
        expect(options).toMatchObject({ sitekey: 'site-key', theme: 'dark', size: 'flexible' });
        // With the browser's default credentials, never 'omit': the dev site's basic auth is one of
        // them, and this path is not among those its door lets through without it.
        expect(api.calls[0].credentials).toBeUndefined();

        act(() => options.callback('token-1'));
        expect(onToken).toHaveBeenLastCalledWith('token-1');

        act(() => options['expired-callback']());
        expect(onToken).toHaveBeenLastCalledWith(null);
    });

    it("says the widget failed, by Cloudflare's code for it, and draws it again on \"Try again\"", async () => {
        stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        const onToken = vi.fn();
        await renderWidget(onToken);

        const options = await latest();
        act(() => {
            // True: handled here, so Turnstile does not throw it into the console.
            expect(options['error-callback']('110200')).toBe(true);
        });

        expect(onToken).toHaveBeenLastCalledWith(null);
        // The code is what tells the owner which failure it was. Nothing here is the reader's to unblock.
        expect(screen.getByRole('alert')).toHaveTextContent('did not finish (Cloudflare error 110200)');
        expect(screen.getByRole('alert')).not.toHaveTextContent('blocks');

        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

        await latest(2);
        expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says the widget failed when it reports no code, or will not draw at all', async () => {
        stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        vi.mocked(turnstile.render).mockImplementationOnce(() => {
            throw new Error('Invalid input for parameter "sitekey"');
        });
        const onToken = vi.fn();
        await renderWidget(onToken);

        expect(await screen.findByRole('alert')).toHaveTextContent('The check that you are a person did not finish.');
        expect(onToken).toHaveBeenLastCalledWith(null);

        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
        const options = await latest();
        act(() => {
            options['error-callback']();
        });

        expect(screen.getByRole('alert')).toHaveTextContent('The check that you are a person did not finish.');
        expect(screen.getByRole('alert')).not.toHaveTextContent('Cloudflare error');
    });

    it('says signing up is not available when the deployment has no site key', async () => {
        // A deployment with no keys answers 503, and takes no sign-ups. Not a thing the reader can unblock.
        stubApi({ 'GET /api/auth/turnstile': () => empty(503) });
        const onToken = vi.fn();
        await renderWidget(onToken);

        expect(await screen.findByRole('alert')).toHaveTextContent('Signing up is not available just now.');
        expect(turnstile.render).not.toHaveBeenCalled();
        expect(onToken).toHaveBeenLastCalledWith(null);
    });

    it("says what to unblock when Cloudflare's script does not load, and loads it again on \"Try again\"", async () => {
        stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        delete window.turnstile;
        // jsdom fetches no script, so the element the page adds is failed by hand, as a blocker fails it.
        const added: HTMLScriptElement[] = [];
        const append = vi.spyOn(document.head, 'append').mockImplementation((...nodes) => {
            added.push(...nodes.filter((node): node is HTMLScriptElement => node instanceof HTMLScriptElement));
        });
        const onToken = vi.fn();
        await renderWidget(onToken);

        await waitFor(() => expect(added).toHaveLength(1));
        expect(added[0].src).toBe('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
        act(() => added[0].onerror?.(new Event('error')));

        expect(await screen.findByRole('alert')).toHaveTextContent('If something blocks challenges.cloudflare.com');
        expect(onToken).toHaveBeenLastCalledWith(null);

        // Unblocked: the second element loads, and the widget is drawn.
        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(added).toHaveLength(2));
        window.turnstile = turnstile;
        act(() => added[1].onload?.(new Event('load')));

        await latest();
        expect(screen.queryByRole('alert')).toBeNull();
        append.mockRestore();
    });

    it('removes its widget when the form goes', async () => {
        stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        const { unmount } = await renderWidget(vi.fn());
        await latest();

        unmount();

        expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
    });
});
