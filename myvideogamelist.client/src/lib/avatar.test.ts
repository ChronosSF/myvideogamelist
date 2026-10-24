import { describe, expect, it } from 'vitest';
import { avatarInitial, avatarSource } from '@/lib/avatar';

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
        ['a host that ends like a listed one', 'https://notgravatar.com/avatar/x'],
        ['a listed host\'s subdomain', 'https://evil.i.imgur.com/x.png'],
        ['a listed host with more after it', 'https://i.imgur.com.example/x.png'],
        ['a host kept off the list', 'https://static-cdn.jtvnw.net/x.png'],
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
