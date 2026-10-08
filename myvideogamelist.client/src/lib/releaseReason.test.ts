import { describe, expect, it } from 'vitest';
import { entryReason, platformNames, releaseReason, showsPlatformsApart } from '@/lib/releaseReason';
import { connectedRelease, platform, releaseEntry } from '@/test/factories';

const SWITCH_2 = platform(508, 'Nintendo Switch 2', 'Switch 2');
const PS5 = platform(167, 'PlayStation 5', 'PS5');

describe('releaseReason for the game itself (R1)', () => {
    it('says the membership and where it is out, which is the news', () => {
        const release = connectedRelease({ gameId: 19686, title: 'Resident Evil 2', platforms: [SWITCH_2], reason: { gameId: 19686 } });

        expect(releaseReason(release)).toBe('On your wishlist — out on Switch 2');
    });

    it.each([
        ['favourite', null, 'A favourite of yours'],
        ['list', 'finished', 'You finished it'],
        ['list', 'playing', "You're playing it"],
        ['list', 'on_hold', 'You put it on hold'],
        ['list', 'backlog', 'You plan to play it'],
    ] as const)('says a %s (%s) as what the user did with it', (membership, list, said) => {
        const release = connectedRelease({ platforms: [PS5], reason: { membership, list } });

        expect(releaseReason(release)).toBe(`${said} — out on PS5`);
    });

    it('says early access rather than out', () => {
        const release = connectedRelease({ platforms: [PS5], earlyAccess: true });

        expect(releaseReason(release)).toBe('On your wishlist — early access on PS5');
    });

    it('stops at the membership when IGDB named no platform', () => {
        expect(releaseReason(connectedRelease())).toBe('On your wishlist');
        expect(releaseReason(connectedRelease({ earlyAccess: true }))).toBe('On your wishlist — early access');
    });

    it('names an edition the user tracks by its own name, which F3 shows as the game', () => {
        const release = connectedRelease({
            gameId: 287297,
            title: 'Grand Theft Auto VI',
            platforms: [PS5],
            reason: { gameId: 407999, title: 'Grand Theft Auto VI: Ultimate Edition' },
        });

        expect(releaseReason(release)).toBe('Grand Theft Auto VI: Ultimate Edition is on your wishlist — out on PS5');
    });
});

describe('releaseReason for a child of the game (R2)', () => {
    it('says what it is to the game, and the game after it', () => {
        const release = connectedRelease({
            kind: 'expansion',
            reason: { relation: 'child', title: 'Elden Ring', membership: 'favourite' },
        });

        expect(releaseReason(release)).toBe('Expansion for Elden Ring, a favourite');
    });

    it.each([
        ['dlc', 'list', 'playing', "DLC for Street Fighter 6, which you're playing"],
        ['remaster', 'list', 'finished', 'Remaster of Street Fighter 6, which you finished'],
        ['remake', 'wishlist', null, 'Remake of Street Fighter 6, on your wishlist'],
        ['game', 'list', 'backlog', 'New edition of Street Fighter 6, which you plan to play'],
    ] as const)('a %s for a game in the %s', (kind, membership, list, said) => {
        const release = connectedRelease({
            kind,
            reason: { relation: 'child', title: 'Street Fighter 6', membership, list },
        });

        expect(releaseReason(release)).toBe(said);
    });

    it('never names a list, which its owner may have renamed', () => {
        // "you finished it" stays true whatever Finished is called; "in your Finished" would print a
        // default name the user may have replaced (ADR 0031).
        const said = releaseReason(connectedRelease({ kind: 'dlc', reason: { relation: 'child', title: 'Hades', membership: 'list', list: 'backlog' } }));

        expect(said).not.toMatch(/backlog/i);
    });
});

describe('releaseReason for the series (R3)', () => {
    it('says the series and the game in it the user has', () => {
        const release = connectedRelease({
            reason: { relation: 'series', title: 'God of War', membership: 'list', list: 'finished', series: 'God of War' },
        });

        expect(releaseReason(release)).toBe('From the God of War series — you finished God of War');
    });

    it('does not say "the The" for a series IGDB names with its article', () => {
        const release = connectedRelease({
            reason: { relation: 'series', title: 'The Witcher 3: Wild Hunt', membership: 'favourite', series: 'The Witcher' },
        });

        expect(releaseReason(release)).toBe('From The Witcher series — The Witcher 3: Wild Hunt is a favourite');
    });
});

describe('releaseReason for a game IGDB no longer answers for', () => {
    it('still says how the release is connected, without a name it does not have', () => {
        const dlc = connectedRelease({ kind: 'dlc', reason: { relation: 'child', title: null } });
        const sequel = connectedRelease({ reason: { relation: 'series', title: null, series: 'Hades' } });

        expect(releaseReason(dlc)).toBe('DLC for one of your games');
        expect(releaseReason(sequel)).toBe('From the Hades series, like one of your games');
    });
});

describe('entryReason for a group (F6)', () => {
    const kingdomHearts = (relation: 'itself' | 'child' | 'series') => releaseEntry('2026-10-16', [
        connectedRelease({ gameId: 1, title: 'Kingdom Hearts III', kind: relation === 'child' ? 'dlc' : 'game', reason: { relation, gameId: 10, title: 'Kingdom Hearts III', membership: 'list', list: 'finished', series: 'Kingdom Hearts' } }),
        connectedRelease({ gameId: 2, title: 'Kingdom Hearts 0.2', reason: { relation: 'series', gameId: 10, title: 'Kingdom Hearts III', membership: 'list', list: 'finished', series: 'Kingdom Hearts' } }),
    ], 'Kingdom Hearts');

    it('says the strongest reason of the group, which comes first', () => {
        expect(entryReason(kingdomHearts('itself'))).toBe('Includes Kingdom Hearts III, which you finished');
        expect(entryReason(kingdomHearts('series'))).toBe('From the Kingdom Hearts series — you finished Kingdom Hearts III');
    });

    it('does not call a whole group what its first release is', () => {
        expect(entryReason(kingdomHearts('child'))).toBe('Connected to Kingdom Hearts III, which you finished');
    });

    it('calls a run of DLC for one game what it is', () => {
        const arjun = releaseEntry('2026-10-13', [
            connectedRelease({ gameId: 1, kind: 'dlc', title: 'Year 4 - Arjun', reason: { relation: 'child', gameId: 9, title: 'Street Fighter 6', membership: 'list', list: 'playing' } }),
            connectedRelease({ gameId: 2, kind: 'dlc', title: 'Additional Character - Arjun & Outfit 2', reason: { relation: 'child', gameId: 9, title: 'Street Fighter 6', membership: 'list', list: 'playing' } }),
        ], 'Street Fighter 6');

        expect(entryReason(arjun)).toBe("DLC for Street Fighter 6, which you're playing");
    });

    it('is the release reason itself for an entry of one', () => {
        const single = releaseEntry('2026-10-16', [connectedRelease({ platforms: [SWITCH_2] })]);

        expect(entryReason(single)).toBe('On your wishlist — out on Switch 2');
    });
});

describe('platforms on a card', () => {
    it('names them short, as the rails do', () => {
        expect(platformNames([PS5, SWITCH_2])).toBe('PS5, Switch 2');
    });

    it('gives them a line of their own only where the reason does not already say them', () => {
        expect(showsPlatformsApart(connectedRelease({ platforms: [PS5] }))).toBe(false);
        expect(showsPlatformsApart(connectedRelease({ platforms: [PS5], reason: { relation: 'child' } }))).toBe(true);
        expect(showsPlatformsApart(connectedRelease({ platforms: [], reason: { relation: 'series' } }))).toBe(false);
    });
});
