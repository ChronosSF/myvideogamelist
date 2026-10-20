import { describe, expect, it, vi } from 'vitest';
import { AVATAR_HOSTS } from '@/lib/avatar';
import {
    applySecurityHeaders,
    createNonce,
    documentPolicy,
    RESOURCE_POLICY,
} from '@/lib/securityHeaders';

/** A policy as directive name to its sources, so a test can ask about one directive at a time. */
function directives(policy: string): Map<string, string[]> {
    return new Map(
        policy.split(';').map((directive) => {
            const [name, ...sources] = directive.trim().split(/\s+/);
            return [name, sources];
        }),
    );
}

describe('applySecurityHeaders', () => {
    it('states a policy for sniffing, framing, referrers and content', () => {
        const headers = applySecurityHeaders(new Headers(), documentPolicy('abc'));

        expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(headers.get('X-Frame-Options')).toBe('DENY');
        expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(headers.get('Content-Security-Policy')).toBe(documentPolicy('abc'));
    });

    it('leaves the headers the route already set alone', () => {
        const headers = applySecurityHeaders(
            new Headers({ 'Cache-Control': 'private, no-store' }),
            documentPolicy('abc'),
        );

        // Every route declares a Cache-Control (ADR 0013) and this runs after it does.
        expect(headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('replaces a policy an earlier render set, rather than adding a second', () => {
        // An error boundary replacing a failed shell is a second render over the same headers. Two
        // policies would both be enforced, and the first one's nonce is on no script in the body.
        const headers = applySecurityHeaders(new Headers(), documentPolicy('first'));
        applySecurityHeaders(headers, documentPolicy('second'));

        expect(headers.get('Content-Security-Policy')).toBe(documentPolicy('second'));
    });
});

describe('documentPolicy', () => {
    it('is exactly this, so that a change to it is a change to this test', () => {
        // Written out whole, so a host added or lost anywhere in the chain that builds it shows here.
        expect(documentPolicy('abc')).toBe(
            "script-src 'self' 'nonce-abc'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            + "img-src 'self' https://images.igdb.com https://gravatar.com "
            + 'https://www.gravatar.com https://secure.gravatar.com https://0.gravatar.com '
            + 'https://1.gravatar.com https://2.gravatar.com https://avatars.githubusercontent.com '
            + 'https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com '
            + 'https://avatars.fastly.steamstatic.com https://i.imgur.com',
        );
    });

    it('runs scripts from this origin and inline scripts carrying the nonce, and nothing else', () => {
        const scriptSrc = directives(documentPolicy('abc')).get('script-src');

        // 'unsafe-inline' would admit an injected script outright; 'unsafe-eval' and a scheme or a
        // wildcard would each widen what an injection can load. 'strict-dynamic' is a different
        // policy, to be chosen on purpose when a third party's loader needs it (ADR 0053).
        expect(scriptSrc).toEqual(["'self'", "'nonce-abc'"]);
    });

    it('closes the two ways around script-src', () => {
        const policy = directives(documentPolicy('abc'));

        expect(policy.get('base-uri')).toEqual(["'none'"]);
        expect(policy.get('object-src')).toEqual(["'none'"]);
        expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    });
});

describe('the images a page may load', () => {
    const imgSrc = () => directives(documentPolicy('abc')).get('img-src');

    it('come from this origin, IGDB and the avatar hosts, and nowhere else', () => {
        expect(imgSrc()).toEqual([
            "'self'",
            'https://images.igdb.com',
            ...AVATAR_HOSTS.map(host => `https://${host}`),
        ]);
    });

    it('name hosts, never a scheme or a wildcard that would admit any of them', () => {
        // `https:` would send every reader's browser wherever a profile's owner pointed their avatar,
        // which is the whole of what ADR 0056 decided against. A third party that publishes its
        // hosts only as wildcards (#242, #143) is a decision to take in that record, not here.
        for (const source of imgSrc() ?? []) {
            expect(source).not.toMatch(/^(https?|data|blob):$/);
            expect(source).not.toContain('*');
            if (source !== "'self'") expect(source).toMatch(/^https:\/\/[a-z0-9.-]+$/);
        }
    });
});

describe('createNonce', () => {
    it('comes from the cryptographic source, not from Math.random', () => {
        const getRandomValues = vi.spyOn(crypto, 'getRandomValues');

        createNonce();

        expect(getRandomValues).toHaveBeenCalledWith(expect.any(Uint8Array));
        expect(getRandomValues.mock.calls[0][0]).toHaveLength(16);
    });

    it('is 128 bits, written the way a nonce source is spelled', () => {
        const nonce = createNonce();

        // CSP's base64-value: the base64 alphabet, padded. Sixteen bytes encode to 24 characters.
        expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
        expect(atob(nonce)).toHaveLength(16);
    });

    it('is different every time', () => {
        const nonces = new Set(Array.from({ length: 100 }, createNonce));

        expect(nonces.size).toBe(100);
    });
});

describe('RESOURCE_POLICY', () => {
    it('lets a response that renders nothing load nothing, and not be framed', () => {
        // The API's policy, for the API's reason, and exactly that.
        expect(RESOURCE_POLICY).toBe("default-src 'none'; frame-ancestors 'none'");
    });
});
