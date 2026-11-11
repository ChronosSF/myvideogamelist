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
        // Public, so asked for without the session.
        expect(api.calls[0].credentials).toBe('omit');

        act(() => options.callback('token-1'));
        expect(onToken).toHaveBeenLastCalledWith('token-1');

        act(() => options['expired-callback']());
        expect(onToken).toHaveBeenLastCalledWith(null);
    });

    it('says the check could not load, and draws it again on "Try again"', async () => {
        stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        const onToken = vi.fn();
        await renderWidget(onToken);

        const options = await latest();
        act(() => {
            // True: handled here, so Turnstile does not throw it into the console.
            expect(options['error-callback']('110200')).toBe(true);
        });

        expect(onToken).toHaveBeenLastCalledWith(null);
        expect(screen.getByRole('alert')).toHaveTextContent('could not load');

        await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));

        await latest(2);
        expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('says the check could not load when the deployment has no site key', async () => {
        // A deployment with no keys answers 503, and takes no sign-ups.
        stubApi({ 'GET /api/auth/turnstile': () => empty(503) });
        const onToken = vi.fn();
        await renderWidget(onToken);

        expect(await screen.findByRole('alert')).toHaveTextContent('could not load');
        expect(turnstile.render).not.toHaveBeenCalled();
        expect(onToken).toHaveBeenLastCalledWith(null);
    });

    it('removes its widget when the form goes', async () => {
        stubApi({ 'GET /api/auth/turnstile': () => json({ siteKey: 'site-key' }) });
        const { unmount } = await renderWidget(vi.fn());
        await latest();

        unmount();

        expect(turnstile.remove).toHaveBeenCalledWith('widget-1');
    });
});
