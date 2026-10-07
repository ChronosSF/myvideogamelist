import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProfilePage, meta } from '@/pages/ProfilePage';
import type { PublicActivity, PublicProfile } from '@/types/profile';
import type { Route } from './+types/ProfilePage';

type Tag = Partial<Record<'title' | 'name' | 'property' | 'content' | 'rel' | 'href', string>>;

const SITE = { siteUrl: 'https://myvideogamelist.net', indexable: true };

/**
 * The tags for a profile, given only the figures `meta` reads. The rest of the document is the
 * component's business and is left out, which is what the cast is for.
 */
function tagsFor({ userName = 'AliceInChains', page = 1, recorded = 12, favourites = 0 } = {}): Tag[] {
    const profile = {
        userName,
        favourites,
        library: { tracked: recorded, recorded, byStatus: { finished: 3 } },
    };

    return meta({ loaderData: { profile, page, site: SITE } } as unknown as Route.MetaArgs) as Tag[];
}

const canonical = (tags: Tag[]) => tags.find(tag => tag.rel === 'canonical')?.href;
const noindex = (tags: Tag[]) => tags.some(tag => tag.name === 'robots' && tag.content?.includes('noindex'));

describe('ProfilePage meta', () => {
    it('calls itself by the name as its owner wrote it, not as the URL was typed', () => {
        // The lookup ignores case, so `/u/aliceinchains` and `/u/ALICEINCHAINS` both render. The
        // name here is the API's answer, and it is the spelling the sitemap lists too.
        expect(canonical(tagsFor())).toBe('https://myvideogamelist.net/u/AliceInChains');
    });

    it('gives each page of reviews its own canonical URL, and the first page none of the query', () => {
        expect(canonical(tagsFor({ page: 3 }))).toBe('https://myvideogamelist.net/u/AliceInChains?page=3');
        expect(canonical(tagsFor({ page: 1 }))).toBe('https://myvideogamelist.net/u/AliceInChains');
    });

    it('says whose profile it is in Open Graph terms', () => {
        const tags = tagsFor();

        expect(tags).toContainEqual({ property: 'og:type', content: 'profile' });
        expect(tags).toContainEqual({ property: 'profile:username', content: 'AliceInChains' });
    });

    it('keeps a published profile with nothing on it out of the index', () => {
        // The same test `SitemapService.ListedProfiles` applies on the server. A page listed in the
        // sitemap and marked noindex is reported as an error, so the two must not disagree.
        const empty = tagsFor({ recorded: 0, favourites: 0 });

        expect(noindex(empty)).toBe(true);
        expect(canonical(empty)).toBeUndefined();
    });

    it('indexes a profile whose only content is a shelf of favourites', () => {
        // A favourite needs no entry (ADR 0029), so nothing recorded is not the same as nothing here.
        expect(noindex(tagsFor({ recorded: 0, favourites: 4 }))).toBe(false);
    });
});

/**
 * A published profile whose library came by import and has never been moved here: games on every
 * shelf, a chart drawn from the dates on their playthroughs, and no status change at all — so no
 * `trackingSince`. Each test narrows it to what it is about.
 */
function importedProfile(activity: Partial<PublicActivity> = {}, recorded = 606): PublicProfile {
    return {
        userName: 'ChronosSF',
        activity: {
            trackingSince: null,
            months: [{ month: '2026-09', started: 2, finished: 2, dropped: 0 }],
            currentStreakMonths: 5,
            longestStreakMonths: 8,
            ...activity,
        },
        library: {
            tracked: recorded,
            recorded,
            wishlisted: 0,
            byStatus: { backlog: 0, playing: 0, on_hold: 0, finished: recorded, dropped: 0 },
            completionRate: recorded === 0 ? null : 1,
        },
        scores: { scored: 0, mean: null, distribution: Array(10).fill(0) },
        playtime: { playthroughs: 0, totalMinutes: 0, withHours: 0 },
        reviews: 0,
        favourites: 0,
    };
}

function renderProfile(profile: PublicProfile) {
    const loaderData = { profile, reviews: null, favourites: null, page: 1, site: SITE };
    return render(
        <MemoryRouter>
            <ProfilePage {...({ loaderData } as unknown as Route.ComponentProps)} />
        </MemoryRouter>,
    );
}

describe('ProfilePage header', () => {
    it('dates the tracking from the first status change', () => {
        renderProfile(importedProfile({ trackingSince: '2026-08-25T14:16:17+00:00' }));

        expect(screen.getByText('Tracking games here since 25 August 2026.')).toBeInTheDocument();
    });

    it('gives no date for an imported library with no status change, and does not call it empty', () => {
        // An import writes no events (ADR 0026 §2) and an imported date is not when tracking began
        // here (ADR 0047), so there is no date to give — and with 606 games on the page,
        // "has not tracked anything here yet" would be untrue.
        renderProfile(importedProfile());

        expect(screen.queryByText(/tracking games here since/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/has not tracked anything here yet/i)).not.toBeInTheDocument();
        // The chart below still shows what the dates say.
        expect(screen.getByText('2026-09: started 2, finished 2, dropped 0')).toBeInTheDocument();
    });

    it('says there is nothing yet when there is nothing at all', () => {
        renderProfile(importedProfile({ months: [], currentStreakMonths: 0, longestStreakMonths: 0 }, 0));

        expect(screen.getByText('Has not tracked anything here yet.')).toBeInTheDocument();
        expect(screen.getByText('No status changes or playthrough dates recorded yet.')).toBeInTheDocument();
    });
});
