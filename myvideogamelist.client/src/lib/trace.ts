/**
 * What a page may know of the trace its request was served under: the part that survives into the
 * browser. The rest — drawing the trace, sending it to the API — is server-only, in
 * `@/lib/trace.server`, and ADR 0059 is the reasoning.
 */

/**
 * What a loader throws when the API failed it: a sentence for the page, and the id somebody
 * reporting the failure can quote. The id is the render's trace, which the API continued, so it is
 * also the `traceId` on every line the API logged for that render and in its own error body.
 *
 * Carried in the error itself rather than read from the document, because the error page is also
 * what a client-side navigation lands on. That request was a `.data` fetch with a trace of its own,
 * and only its answer can say which.
 */
export interface UpstreamFailure {
    message: string;
    traceId: string;
}

export function isUpstreamFailure(data: unknown): data is UpstreamFailure {
    if (typeof data !== 'object' || data === null) return false;

    const { message, traceId } = data as Record<string, unknown>;
    return typeof message === 'string' && typeof traceId === 'string';
}
