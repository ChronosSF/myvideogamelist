/**
 * The cookie the API sets while a browser is signed in, which says nothing about who (ADR 0074): the
 * server's `SignedInFlag.CookieName`, held to it by `serverMirrors.test.ts`. The edge keeps a copy of the
 * home page for each value, and the home loader reads it to draw a signed-in reader's top section before
 * `/api/auth/me` has answered.
 */
export const SIGNED_IN_FLAG = 'mvgl_signed_in';

/** Whether a request's `Cookie` header carries the flag. */
export function signedInFlagIn(cookieHeader: string | null): boolean {
    if (cookieHeader === null) return false;
    return cookieHeader.split(';').some(pair => pair.trim() === `${SIGNED_IN_FLAG}=1`);
}
