import { request, type FullConfig } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Where the signed-in session is kept between this setup and the pages that use it. */
export const SIGNED_IN = fileURLToPath(new URL('./.auth/session.json', import.meta.url));

/** Whose session it is: the name and the visibility of the account's public profile. */
export const ACCOUNT = fileURLToPath(new URL('./.auth/account.json', import.meta.url));

/**
 * Signs in once for the whole run. Signing in is limited to ten attempts in five minutes from one
 * address, so a run that signed in for every page would be refused before it was halfway through.
 */
export default async function signIn(config: FullConfig) {
    const { baseURL } = config.projects[0].use;
    const email = process.env.VISUAL_EMAIL;
    const password = process.env.VISUAL_PASSWORD;
    if (!email || !password) throw new Error('Set VISUAL_EMAIL and VISUAL_PASSWORD to a local @test.local account, in the shell or in visual/.env.');

    const api = await request.newContext({ baseURL, ignoreHTTPSErrors: true });
    const response = await api.post('/api/auth/login', {
        // Every write carries it, or the API refuses it (ADR 0033).
        headers: { 'X-MVGL-Request': '1' },
        data: { email, password, rememberMe: false },
    });
    if (!response.ok()) throw new Error(`Signing in answered ${response.status()}.`);

    await api.storageState({ path: SIGNED_IN });

    const me = await api.get('/api/auth/me');
    if (!me.ok()) throw new Error(`Reading the signed-in account answered ${me.status()}.`);
    const { userName, profileVisibility } = await me.json();
    writeFileSync(ACCOUNT, JSON.stringify({ userName, profileVisibility }));
    await api.dispose();
}
