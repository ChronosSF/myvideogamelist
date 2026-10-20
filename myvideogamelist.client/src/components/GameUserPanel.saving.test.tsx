import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { GameUserPanel } from '@/components/GameUserPanel';
import { MAX_SCORE } from '@/lib/score';
import type { ListEntryDto, ListId } from '@/types/list';
import type { ReviewInputDto } from '@/types/playthrough';
import { entry, entryDetail, game, platform, playthrough, review, userProfile } from '@/test/factories';
import { quickActor } from '@/test/actor';
import { AppProviders } from '@/test/providers';
import {
    type ApiCall,
    type ApiRoutes,
    empty,
    expectSentThroughApiFetch,
    held,
    json,
    signedInRoutes,
    stubApi,
    tearDownApi,
} from '@/test/api';

/**
 * The game page's panel inside the app's real providers, signed in through `/api/auth/me`, with only
 * the API played by the test.
 *
 * `GameUserPanel.test.tsx` drives the panel against hand-built contexts, which shows what it asks
 * the providers for. These show what the reader sees and what the API is sent once the real
 * `ListsProvider` is between them: a move shown before the API answers and put back when it refuses
 * (ADR 0022), the whole number a half-star step sends (ADR 0021), and the header every write carries
 * (ADR 0033). Controls are found by their names, never by how they are drawn.
 */

const ALEX = userProfile();
const CELESTE = game({ id: 1, title: 'Celeste', platforms: [platform(6, 'PC (Microsoft Windows)')] });

/** The panel for Celeste, signed in, with Celeste where `lists` puts it. */
function renderPanel(routes: ApiRoutes = {}, lists: Partial<Record<ListId, ListEntryDto[]>> = {}) {
    const api = stubApi({
        ...signedInRoutes(ALEX, lists),
        'GET /api/entries/1': () => empty(404),
        ...routes,
    });
    const onCommunityChange = vi.fn();
    render(
        <AppProviders>
            <GameUserPanel game={CELESTE} profileVisibility="private" onCommunityChange={onCommunityChange} />
        </AppProviders>,
    );
    return { api, onCommunityChange };
}

/** Celeste in Playing, scored 7. */
const PLAYING = { playing: [entry({ game: CELESTE, score: 7 })] };

const LISTS = ['Backlog', 'Playing', 'On Hold', 'Finished', 'Dropped'];

const listButton = (name: string) => screen.getByRole('button', { name });

/**
 * The list the panel shows the game in, by the button that is pressed. Read off every pressed button
 * rather than asked of each list by name: this runs on every poll of a wait, and working out five
 * accessible names each time is what makes a role query slow.
 */
const shownIn = () => screen.queryAllByRole('button', { pressed: true })
    .map(button => button.textContent ?? '')
    .filter(text => LISTS.includes(text));

/** That the button showing this text takes a press, cheaply enough to poll. */
const takesPresses = (text: string) => expect(screen.getByText(text).closest('button')).toBeEnabled();

/**
 * Waits for the three reads that hold controls back: the entry's, which the score waits on, and the
 * wishlist's and the favourites', which their toggles wait on. The list buttons do not wait for the
 * lists, so a test that needs the game in one passes it here, and this waits for it to show.
 */
async function loaded(list: string | null = null) {
    await waitFor(() => {
        expect(screen.getByLabelText('Your score for Celeste')).toBeEnabled();
        takesPresses('Add to wishlist');
        takesPresses('Add to favourites');
    });
    if (list !== null) await waitFor(() => expect(shownIn()).toEqual([list]));
}

/** Waits for the write in flight to land, which the score control is held for along with the rest of the entry. */
const idle = () => waitFor(() => expect(screen.getByLabelText('Your score for Celeste')).toBeEnabled());

/** The score the stars show, or null when none is selected. */
function shownScore(): number | null {
    const checked = screen.getAllByRole<HTMLInputElement>('radio').find(radio => radio.checked);
    return checked === undefined ? null : Number(checked.value);
}

const star = (score: number) => screen.getByRole('radio', { name: `${score} out of ${MAX_SCORE}` });

afterEach(tearDownApi);

describe('GameUserPanel moving between lists, with the real provider', () => {
    it('shows the move before the API answers, holds the other lists meanwhile, and keeps it once saved', async () => {
        const actor = quickActor();
        const move = held();
        const { api } = renderPanel({ 'PUT /api/lists/1': () => move.answer }, PLAYING);
        await loaded('Playing');

        await actor.click(listButton('Finished'));

        // Optimistic: there before the answer, and nothing else can move this game until it lands.
        expect(shownIn()).toEqual(['Finished']);
        expect(listButton('Backlog')).toBeDisabled();
        expect(api.callsTo('PUT', '/api/lists/1')[0].body).toEqual({ status: 'finished' });

        await act(async () => move.release(empty()));

        await waitFor(() => takesPresses('Backlog'));
        expect(shownIn()).toEqual(['Finished']);
    });

    it('puts the game back in the list it was in when the API refuses the move', async () => {
        const actor = quickActor();
        const move = held();
        renderPanel({ 'PUT /api/lists/1': () => move.answer }, PLAYING);
        await loaded('Playing');

        await actor.click(listButton('Finished'));
        expect(shownIn()).toEqual(['Finished']);

        await act(async () => move.release(empty(500)));

        await waitFor(() => expect(shownIn()).toEqual(['Playing']));
        expect(screen.queryByText('Not in any of your lists.')).not.toBeInTheDocument();
    });

    it('puts the game back when taking it out of its list fails', async () => {
        const actor = quickActor();
        const removal = held();
        const { api } = renderPanel({ 'DELETE /api/lists/1': () => removal.answer }, PLAYING);
        await loaded('Playing');

        await actor.click(listButton('Playing'));
        expect(shownIn()).toEqual([]);
        expect(screen.getByText('Not in any of your lists.')).toBeInTheDocument();
        expectSentThroughApiFetch(api.callsTo('DELETE', '/api/lists/1')[0]);

        await act(async () => removal.release(empty(500)));

        await waitFor(() => expect(shownIn()).toEqual(['Playing']));
    });

    // #317: the panel shows the wishlist's and the favourites' failures, and not the lists'.
    it.skip('says so when the API refuses the move, rather than only putting it back (#317)', async () => {
        const actor = quickActor();
        renderPanel({ 'PUT /api/lists/1': () => empty(500) }, PLAYING);
        await loaded('Playing');

        await actor.click(listButton('Finished'));
        await waitFor(() => expect(shownIn()).toEqual(['Playing']));

        expect(screen.getByRole('alert')).toHaveTextContent(/could not|failed/i);
    });
});

describe('GameUserPanel scoring, with the real provider', () => {
    it('sends a half-star step as the whole number the API stores, and a cleared score as none', async () => {
        // Five stars, ten values: half a star is 1 and three and a half are 7, always a whole number
        // (ADR 0021). `ScoreInput`'s suite walks all ten steps; this is what reaches the API.
        const actor = quickActor();
        const { api } = renderPanel({ 'PUT /api/entries/1/score': () => empty() }, PLAYING);
        await loaded('Playing');
        const saves = () => api.callsTo('PUT', '/api/entries/1/score');

        for (const [index, step] of [1, 7, MAX_SCORE].entries()) {
            await actor.click(star(step));
            await waitFor(() => expect(saves()).toHaveLength(index + 1));
            await idle();
        }
        await actor.click(screen.getByRole('button', { name: 'Clear your score for Celeste' }));
        await waitFor(() => expect(saves()).toHaveLength(4));

        expect(saves().map(call => call.body)).toEqual([{ score: 1 }, { score: 7 }, { score: MAX_SCORE }, { score: null }]);
    });

    it('puts the score back, and tells the page nothing changed, when the API refuses it', async () => {
        const actor = quickActor();
        const save = held();
        const { onCommunityChange } = renderPanel({
            'GET /api/entries/1': () => json(entryDetail({ entry: { game: CELESTE, score: 7 } })),
            'PUT /api/entries/1/score': () => save.answer,
        }, PLAYING);
        await loaded('Playing');
        await waitFor(() => expect(shownScore()).toBe(7));

        await actor.click(star(4));
        expect(shownScore()).toBe(4);

        await act(async () => save.release(empty(500)));

        await waitFor(() => expect(shownScore()).toBe(7));
        expect(onCommunityChange).not.toHaveBeenCalled();
    });
});

describe('GameUserPanel notes, with the real provider', () => {
    it('saves the notes trimmed through the entry endpoint, and holds them as saved', async () => {
        const actor = quickActor();
        const { api } = renderPanel({ 'PUT /api/entries/1/notes': () => empty() });
        await loaded();

        await actor.type(screen.getByLabelText('Your notes'), '  Beat the B-sides on a pad.  ');
        await actor.click(screen.getByRole('button', { name: 'Save notes' }));

        await waitFor(() => expect(screen.getByLabelText('Your notes')).toHaveValue('Beat the B-sides on a pad.'));
        expect(api.callsTo('PUT', '/api/entries/1/notes')[0].body).toEqual({ notes: 'Beat the B-sides on a pad.' });
        // Saved, so there is nothing to save until it changes again.
        expect(screen.getByRole('button', { name: 'Save notes' })).toBeDisabled();
    });
});

describe('GameUserPanel playthroughs and the review', () => {
    it('lists a run logged with an earlier start above the runs that started after it', async () => {
        // In the order the server reads them back, by start date — so the numbers the review's select
        // gives the runs do not change on the next page load.
        const actor = quickActor();
        const later = playthrough({ id: 5, type: 'normally', startedOn: '2026-03-01' });
        renderPanel({
            'GET /api/entries/1': () => json(entryDetail({ entry: { game: CELESTE }, playthroughs: [later] })),
            'POST /api/entries/1/playthroughs': () =>
                json(playthrough({ id: 9, type: 'rushed', startedOn: '2026-01-05', createdAt: '2026-10-17T12:00:00Z' }), 201),
        });
        await loaded();

        await actor.selectOptions(screen.getByLabelText('How you played it'), 'Rushed');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));

        await waitFor(() => expect(screen.getAllByRole('option', { name: /^\d\. / }).map(option => option.textContent))
            .toEqual(['1. Rushed', '2. Normally']));
    });

    // #330: the review form holds on to the id of a run the panel has deleted.
    it.skip('names no playthrough in the review once the one it named is deleted (#330)', async () => {
        // The server lets go of a deleted run's reviews (ADR 0025: the link is SetNull), and refuses a
        // review naming a run that is gone as "not one of yours".
        const actor = quickActor();
        const { api } = renderPanel({
            'GET /api/entries/1': () => json(entryDetail({
                entry: { game: CELESTE },
                playthroughs: [playthrough({ id: 5, type: 'completionist' })],
                review: review({ id: 3, body: 'The completionist run.', playthroughId: 5 }),
            })),
            'DELETE /api/entries/1/playthroughs/5': () => empty(),
            'PUT /api/entries/1/review': (call: ApiCall) => json(review({ id: 3, ...(call.body as ReviewInputDto) })),
        });
        await loaded();

        await actor.click(screen.getByRole('button', { name: 'Delete playthrough 1' }));
        await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete playthrough 1' })).not.toBeInTheDocument());
        await actor.click(screen.getByRole('button', { name: 'Update review' }));

        await waitFor(() => expect(api.callsTo('PUT', '/api/entries/1/review')).toHaveLength(1));
        expect(api.callsTo('PUT', '/api/entries/1/review')[0].body).toMatchObject({ playthroughId: null });
    });
});

/*
 * The API refuses a write without the header (ADR 0033), so one sent with bare `fetch` is a 403 that
 * looks like a bug. Every control on the panel that writes, grouped by what sends the request.
 * Deleting one playthrough or the review is left out: #245 is to make both ask first.
 */
describe('GameUserPanel and the write guard', () => {
    it('marks what the lists provider writes for it: a move, a score, ownership, notes and the delete', async () => {
        const actor = quickActor();
        const { api } = renderPanel({
            'PUT /api/lists/1': () => empty(),
            'PUT /api/entries/1/score': () => empty(),
            'PUT /api/entries/1/ownership': () => empty(),
            'PUT /api/entries/1/notes': () => empty(),
            'DELETE /api/entries/1': () => empty(),
        }, PLAYING);
        await loaded('Playing');

        await actor.click(listButton('Finished'));
        await idle();
        await actor.click(star(8));
        await idle();
        await actor.click(within(screen.getByRole('group', { name: 'How you have it' })).getByRole('button', { name: 'Owned' }));
        await idle();
        await actor.type(screen.getByLabelText('Your notes'), 'Deck.');
        await actor.click(screen.getByRole('button', { name: 'Save notes' }));
        await idle();
        // Last, because it asks first.
        await actor.click(screen.getByRole('button', { name: /delete my data/i }));
        await actor.click(screen.getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(api.callsTo('DELETE', '/api/entries/1')).toHaveLength(1));

        expect(api.writes().map(call => `${call.method} ${call.path}`)).toEqual([
            'PUT /api/lists/1',
            'PUT /api/entries/1/score',
            'PUT /api/entries/1/ownership',
            'PUT /api/entries/1/notes',
            'DELETE /api/entries/1',
        ]);
        for (const write of api.writes()) expectSentThroughApiFetch(write);
    });

    it('marks the wishlist and the favourite toggles, on and off', async () => {
        const actor = quickActor();
        const { api } = renderPanel({
            'PUT /api/wishlist/1': () => json({ addedAt: '2026-10-17T12:00:00Z' }),
            'DELETE /api/wishlist/1': () => empty(),
            'PUT /api/favourites/1': () => json({ addedAt: '2026-10-17T12:00:00Z' }),
            'DELETE /api/favourites/1': () => empty(),
        });
        await loaded();

        await actor.click(screen.getByRole('button', { name: 'Add to wishlist' }));
        await actor.click(await screen.findByText('On your wishlist'));
        await screen.findByText('Add to wishlist');
        await actor.click(screen.getByRole('button', { name: 'Add to favourites' }));
        await actor.click(await screen.findByText('One of your favourites'));
        await screen.findByText('Add to favourites');

        expect(api.writes().map(call => `${call.method} ${call.path}`)).toEqual([
            'PUT /api/wishlist/1',
            'DELETE /api/wishlist/1',
            'PUT /api/favourites/1',
            'DELETE /api/favourites/1',
        ]);
        for (const write of api.writes()) expectSentThroughApiFetch(write);
    });

    it('marks the writes it makes itself: logging and editing a playthrough, and saving the review', async () => {
        const actor = quickActor();
        const logged = playthrough({ id: 9, minutesPlayed: 60 });
        const { api } = renderPanel({
            'POST /api/entries/1/playthroughs': () => json(logged, 201),
            'PUT /api/entries/1/playthroughs/9': () => json({ ...logged, minutesPlayed: 90 }),
            'PUT /api/entries/1/review': () => json(review({ id: 3, body: 'Yes.' })),
        });
        await loaded();

        await actor.type(screen.getByLabelText('Hours'), '1');
        await actor.click(screen.getByRole('button', { name: 'Log playthrough' }));
        await actor.click(await screen.findByText('Edit playthrough 1'));
        await actor.type(screen.getByLabelText('Minutes'), '30');
        await actor.click(screen.getByRole('button', { name: 'Save playthrough' }));
        await screen.findByText('Log playthrough');
        await actor.type(screen.getByLabelText('What you thought'), 'Yes.');
        await actor.click(screen.getByRole('button', { name: 'Save review' }));
        await screen.findByText('Update review');

        expect(api.writes().map(call => `${call.method} ${call.path}`)).toEqual([
            'POST /api/entries/1/playthroughs',
            'PUT /api/entries/1/playthroughs/9',
            'PUT /api/entries/1/review',
        ]);
        for (const write of api.writes()) expectSentThroughApiFetch(write);
    });
});
