import { describe, expect, it } from 'vitest';
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
        expect(documentPolicy('abc')).toBe(
            "script-src 'self' 'nonce-abc'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
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

describe('createNonce', () => {
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
        const policy = directives(RESOURCE_POLICY);

        expect(policy.get('default-src')).toEqual(["'none'"]);
        expect(policy.get('frame-ancestors')).toEqual(["'none'"]);
    });
});
