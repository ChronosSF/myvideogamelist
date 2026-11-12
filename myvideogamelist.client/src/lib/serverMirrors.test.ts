import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AVATAR_HOSTS, AVATAR_SERVICES } from '@/lib/avatar';
import { MIN_DISTRIBUTION_SCORES, MIN_MEMBER_SCORES, MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import { IGDB_IMAGE_HOST } from '@/lib/securityHeaders';
import { SIGNED_IN_FLAG } from '@/lib/signedInFlag';
import { AVATAR_URL_MAX_LENGTH, BIO_MAX_LENGTH, DISPLAY_NAME_MAX_LENGTH } from '@/types/auth';
import { DEFAULT_LOOK, PALETTE_IDS, PATTERN_IDS, TINT_IDS } from '@/types/look';

/**
 * Values the client restates from the server, each read out of the server's own source and compared.
 *
 * Every one of these drifts silently. An avatar host on the server's list and not on the client's
 * is saved and then refused by every reader's browser; a host on the client's and not the server's
 * is one readers can be sent to that nobody can name; IGDB's image host changing on the server
 * without the page's policy following it blocks every cover on the site; and an input's `maxLength`
 * longer than the server's limit is a refusal the form could have prevented; and a community floor
 * the page states differently from the server's says "shown once 5 have" over a game whose fifth
 * score the API still withholds, or hides a figure it sent. `@/types/auth.test.ts`
 * holds the username's rules to `UserNamePolicy` the same way.
 */

/**
 * A file of the repository's, resolved from this file's own path as a string, as `auth.test.ts` does:
 * jsdom replaces the global `URL`, and Node's `fileURLToPath` refuses one of jsdom's.
 */
function repositorySource(path: string): string {
    return readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../..', path), 'utf8');
}

/** A file of the server's. */
function serverSource(path: string): string {
    return repositorySource(`MyVideoGameList.Server/${path}`);
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

/**
 * One of `LookPolicy`'s lists, each entry a string or one of the class's string constants, in order. An
 * entry written any other way fails here rather than being left out.
 */
function lookList(name: string): string[] {
    const source = serverSource('Models/LookPolicy.cs');
    const constants = new Map([...source.matchAll(/public const string (\w+) = "([^"\\]*)";/g)].map(match => [match[1], match[2]]));
    const list = new RegExp(`IReadOnlyList<string> ${name} =\\s*\\[([^\\]]*)\\];`).exec(source);
    if (list === null) throw new Error(`LookPolicy.${name} was not found`);

    return list[1].split(',').map(entry => entry.trim()).map(entry => {
        const literal = /^"([^"\\]*)"$/.exec(entry);
        const value = literal ? literal[1] : constants.get(entry);
        if (value === undefined) throw new Error(`LookPolicy.${name} holds something other than a string: ${entry}`);
        return value;
    });
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

    it('says a figure is withheld under exactly the floors the server withholds it under', () => {
        // The floors are the server's (ADR 0094); the page restates them in the sentences that say why
        // a figure is missing, and in its own check of an answer from an API built before them.
        const floors = serverSource('Models/CommunityFloors.cs');

        expect(MIN_MEMBER_SCORES).toBe(intConstant(floors, 'MemberScores'));
        expect(MIN_DISTRIBUTION_SCORES).toBe(intConstant(floors, 'ScoreDistribution'));
        expect(MIN_PLAYTHROUGH_SAMPLES).toBe(intConstant(floors, 'PlaythroughSamples'));
    });

    it('lets a page load images from the host the server builds every IGDB image address on', () => {
        const base = /ImageBaseUrl = "([^"]+)"/.exec(serverSource('Services/IgdbService.cs'));
        if (base === null) throw new Error('IgdbService.ImageBaseUrl was not found');

        expect(new URL(base[1]).host).toBe(IGDB_IMAGE_HOST);
    });

    it('knows the palettes, patterns and tints the server keeps, in its order, with its defaults', () => {
        // A name only the server knows is drawn as the default; one only the client knows is refused on
        // save, and the head script would draw a stored name the server would never have written (ADR 0082).
        expect([...PALETTE_IDS]).toEqual(lookList('Palettes'));
        expect([...PATTERN_IDS]).toEqual(lookList('Patterns'));
        expect([...TINT_IDS]).toEqual(lookList('Tints'));

        const source = serverSource('Models/LookPolicy.cs');
        expect(source).toContain(`public const string DefaultPalette = "${DEFAULT_LOOK.palette}";`);
        expect(source).toContain(`public const string DefaultPattern = "${DEFAULT_LOOK.pattern}";`);
        expect(source).toContain(`public const string DefaultTint = "${DEFAULT_LOOK.tint}";`);
    });

    it('reads the signed-in flag by the name the server sets it under', () => {
        // Apart, the API would set a cookie the home page never reads, and every signed-in reader would be
        // drawn the welcome first again, with nothing failing (ADR 0074).
        expect(serverSource('Security/SignedInFlag.cs')).toContain(`public const string CookieName = "${SIGNED_IN_FLAG}";`);
    });
});

/**
 * The signed-in flag's name, as the two other places that write it out restate it (ADR 0074). The edge
 * keys the home page on it: a name the API no longer sets would leave both copies the welcome, the flash
 * back for every signed-in reader and nothing failing. The dev check sends it, and with another name would
 * pass on a distribution that keys on nothing.
 */
describe('what the edge and its check restate from the server', () => {
    it('keys the home page on the cookie the server sets', () => {
        expect(repositorySource('infra/src/Infra/Edge.cs')).toContain(`CacheCookieBehavior.AllowList("${SIGNED_IN_FLAG}")`);
    });

    it('checks the home page’s two copies with the cookie the server sets', () => {
        expect(repositorySource('scripts/dev-check.mjs')).toContain(`cookie: '${SIGNED_IN_FLAG}=1'`);
    });
});
