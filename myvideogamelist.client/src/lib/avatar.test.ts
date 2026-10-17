import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATAR_HOSTS, avatarInitial, avatarSource } from '@/lib/avatar';

describe('avatarSource', () => {
    it('loads an https address on a listed host, exactly as stored', () => {
        const url = 'https://avatars.githubusercontent.com/u/9919?v=4';

        expect(avatarSource(url)).toBe(url);
        // The host compared without case, as the server compares it, and nothing rebuilt.
        expect(avatarSource('HTTPS://I.IMGUR.COM/removed.png')).toBe('HTTPS://I.IMGUR.COM/removed.png');
    });

    it.each([
        ['nothing', null],
        ['an empty string', ''],
        ['plain http', 'http://i.imgur.com/removed.png'],
        ['a host not on the list', 'https://example.com/me.png'],
        ['a host that only ends like a listed one', 'https://evil-i.imgur.com.example/x.png'],
        ['a script', 'javascript:alert(1)'],
        ['an inline image', 'data:image/png;base64,iVBORw0KGgo='],
        ['not an address at all', 'my avatar'],
    ])('shows the initial for %s', (_, url) => {
        expect(avatarSource(url)).toBeNull();
    });
});

describe('avatarInitial', () => {
    it('is the first character of the handle, capitalised', () => {
        expect(avatarInitial('alex')).toBe('A');
        expect(avatarInitial('_zed')).toBe('_');
        expect(avatarInitial('9lives')).toBe('9');
    });
});

describe('AVATAR_HOSTS', () => {
    /**
     * `AvatarUrlPolicy.Hosts`, read out of the server's source. The two lists are one decision in
     * two languages — the server's says what may be saved and this one, through the document policy,
     * what a page may load — and a host on only one side is an avatar saved and then never shown, or
     * a host every reader's browser may be sent to that nothing can name.
     */
    function serverHosts(): string[] {
        // From the client's own directory, which is where `npm run test` runs, here and in CI.
        const source = readFileSync(
            resolve(process.cwd(), '../MyVideoGameList.Server/Models/ProfileDetailsPolicy.cs'),
            'utf8',
        );

        const list = /IReadOnlyList<string> Hosts =\s*\[([\s\S]*?)\];/.exec(source);
        if (list === null) throw new Error('AvatarUrlPolicy.Hosts was not found in ProfileDetailsPolicy.cs');

        // The entries are string literals; the comments between them are not.
        return [...list[1].matchAll(/^\s*"([^"]+)",?\s*$/gm)].map(match => match[1]);
    }

    it('names exactly the hosts the server lets an avatar be saved from', () => {
        const server = serverHosts();

        expect(server.length).toBeGreaterThan(0);
        expect([...AVATAR_HOSTS].sort()).toEqual([...server].sort());
    });
});
