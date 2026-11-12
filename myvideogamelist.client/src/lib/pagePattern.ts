import type { UIMatch } from 'react-router';

/**
 * What a route may say, in its `handle`, about the pattern behind the page (`PagePattern`, ADR 0082).
 * `foot`: the page opens with something opaque of its own where the top of the pattern is drawn, so only
 * the foot's is drawn. The game page's hero is one (ADR 0084): all that showed of the top was its faint
 * tail under the tabs, beside a poster it was never drawn to go with.
 */
export interface PagePatternHandle {
    pagePattern?: 'foot';
}

/**
 * Whether the page draws the pattern at its top: unless a route on it says `foot` and rendered. A route
 * whose loader threw renders its error boundary rather than what covered the top, so it gets the pattern
 * back, as any other page has.
 */
export function drawsTopPattern(matches: readonly UIMatch[]): boolean {
    return !matches.some(match =>
        (match.handle as PagePatternHandle | undefined)?.pagePattern === 'foot' && match.loaderData !== undefined);
}
