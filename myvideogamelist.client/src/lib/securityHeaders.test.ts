import { describe, expect, it } from 'vitest';
import { applySecurityHeaders, SECURITY_HEADERS } from '@/lib/securityHeaders';

describe('applySecurityHeaders', () => {
    it('states a policy for sniffing, framing and referrers', () => {
        const headers = applySecurityHeaders(new Headers());

        expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(headers.get('X-Frame-Options')).toBe('DENY');
        expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
        expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
    });

    it('leaves the headers the route already set alone', () => {
        const headers = applySecurityHeaders(new Headers({ 'Cache-Control': 'private, no-store' }));

        // Every route declares a Cache-Control (ADR 0013) and this runs after it does.
        expect(headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('restricts framing without restricting scripts', () => {
        // Naming script-src here would need a nonce on every inline script React Router writes,
        // and getting that wrong renders a blank page. Until that ships, the policy is one
        // directive and this test says so on purpose.
        expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('script-src');
    });
});
