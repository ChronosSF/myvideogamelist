import { describe, expect, it } from 'vitest';
import { AVATAR_HOSTS } from '@/lib/avatar';
import { applySecurityHeaders, SECURITY_HEADERS } from '@/lib/securityHeaders';

/** One directive of the document policy, as its list of sources. */
function directive(name: string): string[] | undefined {
    return SECURITY_HEADERS['Content-Security-Policy']
        .split(';')
        .map(part => part.trim().split(/\s+/))
        .find(([directiveName]) => directiveName === name)
        ?.slice(1);
}

describe('applySecurityHeaders', () => {
    it('states a policy for sniffing, framing and referrers', () => {
        const headers = applySecurityHeaders(new Headers());

        expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(headers.get('X-Frame-Options')).toBe('DENY');
        expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        // Written out whole, so a host added or lost anywhere in the chain that builds it shows here.
        expect(headers.get('Content-Security-Policy')).toBe(
            "frame-ancestors 'none'; img-src 'self' https://images.igdb.com https://gravatar.com "
            + 'https://www.gravatar.com https://secure.gravatar.com https://0.gravatar.com '
            + 'https://1.gravatar.com https://2.gravatar.com https://avatars.githubusercontent.com '
            + 'https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com '
            + 'https://avatars.fastly.steamstatic.com https://i.imgur.com',
        );
    });

    it('leaves the headers the route already set alone', () => {
        const headers = applySecurityHeaders(new Headers({ 'Cache-Control': 'private, no-store' }));

        // Every route declares a Cache-Control (ADR 0013) and this runs after it does.
        expect(headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('restricts framing without restricting scripts', () => {
        // Naming script-src here would need a nonce on every inline script React Router writes,
        // and getting that wrong renders a blank page. Until that ships, the policy restricts
        // what needs no nonce and this test says so on purpose.
        expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('script-src');
        expect(directive('frame-ancestors')).toEqual(["'none'"]);
    });
});

describe('the images a page may load', () => {
    it('come from this origin, IGDB and the avatar hosts, and nowhere else', () => {
        expect(directive('img-src')).toEqual([
            "'self'",
            'https://images.igdb.com',
            ...AVATAR_HOSTS.map(host => `https://${host}`),
        ]);
    });

    it('name hosts, never a scheme or a wildcard that would admit any of them', () => {
        // `https:` would send every reader's browser wherever a profile's owner pointed their avatar,
        // which is the whole of what ADR 0056 decided against. A third party that publishes its
        // hosts only as wildcards (#242, #143) is a decision to take in that record, not here.
        for (const source of directive('img-src') ?? []) {
            expect(source).not.toMatch(/^(https?|data|blob):$/);
            expect(source).not.toContain('*');
            if (source !== "'self'") expect(source).toMatch(/^https:\/\/[a-z0-9.-]+$/);
        }
    });
});
