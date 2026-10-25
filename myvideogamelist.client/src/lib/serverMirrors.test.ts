import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_HOSTS, AVATAR_SERVICES } from '@/lib/avatar';
import { IGDB_IMAGE_HOST } from '@/lib/securityHeaders';
import { SIGNED_IN_FLAG } from '@/lib/signedInFlag';
import { AVATAR_URL_MAX_LENGTH, BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from '@/types/auth';

/**
 * Values the client restates from the server, each read out of the server's own source and compared.
 *
 * Every one of these drifts silently. An avatar host on the server's list and not on the client's
 * is saved and then refused by every reader's browser; a host on the client's and not the server's
 * is one readers can be sent to that nobody can name; IGDB's image host changing on the server
 * without the page's policy following it blocks every cover on the site; and an input's `maxLength`
 * longer than the server's limit is a refusal the form could have prevented. `@/types/auth.test.ts`
 * holds the username's rules to `UserNamePolicy` the same way.
 */

/**
 * A file of the server's, resolved from this file's own path as a string, as `auth.test.ts` does:
 * jsdom replaces the global `URL`, and Node's `fileURLToPath` refuses one of jsdom's.
 */
function serverSource(path: string): string {
    return readFileSync(
        resolve(dirname(fileURLToPath(import.meta.url)), '../../../MyVideoGameList.Server', path),
        'utf8',
    );
}

/** The value of `public const int {name} = …;` in a server source file. */
function intConstant(source: string, name: string): number {
    const match = new RegExp(`public const int ${name} = (\\d+);`).exec(source);
    if (match === null) throw new Error(`no int constant ${name}`);
    return Number(match[1]);
}

/**
 * Every string in `AvatarUrlPolicy.Hosts`. The comments are taken out first, and then nothing may be
 * left but the strings, commas and whitespace: an entry written some other way — a constant, a
 * spread, a second string on a line — fails here rather than being left out of the comparison.
 */
function serverAvatarHosts(): string[] {
    const source = serverSource('Models/AvatarUrlPolicy.cs');
    const list = /IReadOnlyList<string> Hosts =\s*\[([\s\S]*?)\];/.exec(source);
    if (list === null) throw new Error('AvatarUrlPolicy.Hosts was not found');

    const body = list[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const hosts = [...body.matchAll(/"([^"\\]*)"/g)].map(match => match[1]);

    const leftOver = body.replace(/"([^"\\]*)"/g, '').replace(/[\s,]/g, '');
    if (leftOver !== '') throw new Error(`AvatarUrlPolicy.Hosts holds something other than strings: ${leftOver}`);

    return hosts;
}

describe('what the client restates from the server', () => {
    it('lets a page load exactly the avatar hosts the server lets an avatar be saved from', () => {
        const server = serverAvatarHosts();

        expect(server.length).toBeGreaterThan(0);
        expect([...AVATAR_HOSTS].sort()).toEqual([...server].sort());
    });

    it('names the avatar services as the server\'s refusal names them', () => {
        const source = serverSource('Models/AvatarUrlPolicy.cs');

        expect(source).toContain(`public const string Services = "${AVATAR_SERVICES}";`);
    });

    it('holds each field to the length the server does', () => {
        expect(DISPLAY_NAME_MAX_LENGTH).toBe(intConstant(serverSource('Models/DisplayNamePolicy.cs'), 'MaxLength'));
        expect(AVATAR_URL_MAX_LENGTH).toBe(intConstant(serverSource('Models/AvatarUrlPolicy.cs'), 'MaxLength'));
        expect(BIO_MAX_LENGTH).toBe(intConstant(serverSource('Models/BioPolicy.cs'), 'MaxLength'));
    });

    it('lets a page load images from the host the server builds every IGDB image address on', () => {
        const base = /ImageBaseUrl = "([^"]+)"/.exec(serverSource('Services/IgdbService.cs'));
        if (base === null) throw new Error('IgdbService.ImageBaseUrl was not found');

        expect(new URL(base[1]).host).toBe(IGDB_IMAGE_HOST);
    });

    it('reads the signed-in flag by the name the server sets it under', () => {
        // Apart, the API would set a cookie the home page never reads, and every signed-in reader would be
        // drawn the welcome first again, with nothing failing (ADR 0074).
        expect(serverSource('Security/SignedInFlag.cs')).toContain(`public const string CookieName = "${SIGNED_IN_FLAG}";`);
    });
});
