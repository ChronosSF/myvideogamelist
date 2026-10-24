import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { render, screen, waitFor, within } from '@testing-library/react';
import { AuthProvider } from '@/contexts/AuthProvider';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { useAuth } from '@/hooks/useAuth';
import {
    ProfileDetailsError,
    USERNAME_MAX_LENGTH,
    USERNAME_MIN_LENGTH,
    type ProfileDetails,
} from '@/types/auth';
import { type Actor, quickActor } from '@/test/actor';
import { userProfile } from '@/test/factories';
import {
    type ApiCall,
    type ApiRoutes,
    empty,
    expectSentThroughApiFetch,
    held,
    json,
    settle,
    signedInRoutes,
    stubApi,
    tearDownApi,
    unreachable,
} from '@/test/api';
import { AppProviders } from '@/test/providers';

/**
 * The sign-in and sign-up dialogs over the real `AuthProvider`, with only the network played by the
 * test. The dialogs' own suites mock `useAuth`, which leaves out everything between a click and the
 * API: the request each write sends, the header the API's write guard requires (ADR 0033), and how
 * each shape of refusal the API answers becomes the sentence somebody reads. The refusals here carry
 * the API's own sentences, and Identity's, word for word.
 */

const ALEX = userProfile({ id: 'user-1', email: 'alex@test.local', userName: 'alex' });
const PASSWORD = 'Passw0rd1';

/** The sentence `AuthController` answers every refused sign-in with, whatever the reason was. */
const REFUSED = 'Invalid email, username or password.';

/** Who the provider has signed in, as the navbar would say it. */
function Session() {
    const { user, loading } = useAuth();
    if (loading) return <p>Asking who is signed in</p>;
    return <p>{user === null ? 'Nobody is signed in' : `Signed in as ${user.userName}`}</p>;
}

/**
 * `/api/auth/login` as `AuthController` answers it: an account found by its email address or by its
 * username, locked by Identity after five failed attempts — and one 401, word for word, for an
 * unknown account, a wrong password and a locked account alike.
 */
function loginAsTheApiDoes() {
    let failures = 0;
    return (call: ApiCall) => {
        const { email, password } = call.body as { email: string; password: string };
        const found = email === ALEX.email || email.toUpperCase() === ALEX.userName.toUpperCase();
        if (found && failures < 5 && password === PASSWORD) return json(ALEX);
        if (found) failures++;
        return json({ message: REFUSED }, 401);
    };
}

const onClose = vi.fn();

/** The provider with nobody signed in yet, the sign-in dialog open, and `/me` answered. */
async function openSignIn(routes: ApiRoutes = {}) {
    const api = stubApi({
        'GET /api/auth/me': () => empty(401),
        'POST /api/auth/login': loginAsTheApiDoes(),
        ...routes,
    });
    render(
        <AuthProvider>
            <Session />
            <LoginDialog onClose={onClose} onSwitchToRegister={vi.fn()} />
        </AuthProvider>,
    );
    await screen.findByText('Nobody is signed in');
    return api;
}

/** The same, with the sign-up dialog. */
async function openSignUp(routes: ApiRoutes = {}) {
    const api = stubApi({
        'GET /api/auth/me': () => empty(401),
        'POST /api/auth/register': call => json(userProfile({
            ...ALEX,
            ...(call.body as { email: string; userName: string }),
        })),
        ...routes,
    });
    render(
        <AuthProvider>
            <Session />
            <SignupDialog onClose={onClose} onSwitchToLogin={vi.fn()} />
        </AuthProvider>,
    );
    await screen.findByText('Nobody is signed in');
    return api;
}

/** Fills in the sign-in dialog and submits it. */
async function signIn(actor: Actor, identifier: string, password = PASSWORD) {
    await actor.type(screen.getByLabelText('Email or username'), identifier);
    await actor.type(screen.getByLabelText('Password'), password);
    await actor.click(screen.getByRole('button', { name: 'Sign In' }));
}

/** Submits the sign-in dialog again with another password, and waits for its answer. */
async function retryPassword(actor: Actor, password: string) {
    await actor.clear(screen.getByLabelText('Password'));
    await actor.type(screen.getByLabelText('Password'), password);
    await actor.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeEnabled());
}

/** Fills in the sign-up dialog and submits it. */
async function signUp(actor: Actor, userName: string) {
    await actor.type(screen.getByLabelText('Username'), userName);
    await actor.type(screen.getByLabelText('Email'), ALEX.email);
    await actor.type(screen.getByLabelText('Password'), PASSWORD);
    await actor.type(screen.getByLabelText('Confirm Password'), PASSWORD);
    await actor.click(screen.getByRole('button', { name: 'Create Account' }));
}

/** Submits the sign-up dialog again with another username, the rest as it was. */
async function retryUserName(actor: Actor, userName: string) {
    await actor.clear(screen.getByLabelText('Username'));
    await actor.type(screen.getByLabelText('Username'), userName);
    await actor.click(screen.getByRole('button', { name: 'Create Account' }));
}

beforeEach(() => {
    onClose.mockReset();
});

afterEach(tearDownApi);

describe('AuthProvider on load', () => {
    it('asks the API who is signed in, with the session cookie', async () => {
        const api = stubApi({ 'GET /api/auth/me': () => json(ALEX) });
        render(<AuthProvider><Session /></AuthProvider>);

        expect(screen.getByText('Asking who is signed in')).toBeInTheDocument();
        expect(await screen.findByText('Signed in as alex')).toBeInTheDocument();
        expect(api.callsTo('GET', '/api/auth/me')[0].credentials).toBe('include');
    });

    it('takes a refused answer for nobody signed in', async () => {
        stubApi({ 'GET /api/auth/me': () => empty(401) });
        render(<AuthProvider><Session /></AuthProvider>);

        expect(await screen.findByText('Nobody is signed in')).toBeInTheDocument();
    });

    it('takes an unreachable API for nobody signed in, without an unhandled rejection', async () => {
        const unhandled: unknown[] = [];
        const record = (reason: unknown) => unhandled.push(reason);
        process.on('unhandledRejection', record);
        try {
            stubApi({ 'GET /api/auth/me': unreachable });
            render(<AuthProvider><Session /></AuthProvider>);

            expect(await screen.findByText('Nobody is signed in')).toBeInTheDocument();
            await settle();
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', record);
        }
    });

    it('reads the account once when Strict Mode hydrates the providers', async () => {
        // React Router's client entry hydrates every page inside <StrictMode>, and since React 19.3
        // that runs a hydrated tree's effects twice in development, so `/me` is asked twice. Were the
        // first answer applied too, the second would hand the providers an equal but new `user`, and
        // every read keyed on it would go out again. The answers are released one at a time, as a
        // network delivers them: released together they would be batched into one render, which
        // hides exactly that.
        const answers = [held(), held()];
        let asked = 0;
        const api = stubApi({
            ...signedInRoutes(ALEX),
            'GET /api/auth/me': () => answers[asked++].answer,
        });
        const page = <StrictMode><AppProviders><Session /></AppProviders></StrictMode>;
        const container = document.body.appendChild(document.createElement('div'));
        container.innerHTML = renderToString(page);

        render(page, { container, hydrate: true });
        for (const { release } of answers) {
            release(json(ALEX));
            await settle();
        }

        expect(asked, 'Strict Mode asked who is signed in twice').toBe(2);
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
        for (const path of ['/api/lists', '/api/user/list-preferences', '/api/wishlist', '/api/favourites']) {
            expect(api.callsTo('GET', path), path).toHaveLength(1);
        }
    });
});

describe('AuthProvider signing in', () => {
    it('signs in by email address, through the write guard, and closes the dialog', async () => {
        const actor = quickActor();
        const api = await openSignIn();

        await signIn(actor, 'alex@test.local');

        expect(await screen.findByText('Signed in as alex')).toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);

        const [login] = api.callsTo('POST', '/api/auth/login');
        expect(login.body).toEqual({ email: 'alex@test.local', password: PASSWORD, rememberMe: false });
        expectSentThroughApiFetch(login);
    });

    it('signs in by username in the same box, sending it as typed for the API to resolve', async () => {
        // One field for either, and the dialog says so (ADR 0027). Nothing on this side may refuse a
        // name for not being an address: telling the two apart is the server's lookup.
        const actor = quickActor();
        const api = await openSignIn();

        await signIn(actor, 'alex');

        expect(await screen.findByText('Signed in as alex')).toBeInTheDocument();
        expect(api.callsTo('POST', '/api/auth/login')[0].body).toMatchObject({ email: 'alex' });
    });

    it('asks to be remembered when the box is ticked', async () => {
        // Unticked, it asks not to be, as the sign-in by email above shows.
        const actor = quickActor();
        const api = await openSignIn();

        await actor.click(screen.getByLabelText('Remember me'));
        await signIn(actor, 'alex');

        await screen.findByText('Signed in as alex');
        expect(api.callsTo('POST', '/api/auth/login')[0].body).toMatchObject({ rememberMe: true });
    });

    it("shows the API's own sentence for a wrong password, and stays open with nobody signed in", async () => {
        const actor = quickActor();
        await openSignIn();

        await signIn(actor, 'alex', 'not-the-password');

        expect(await screen.findByRole('alert')).toHaveTextContent(REFUSED);
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('reads a locked-out account exactly as a wrong password, even once the password is right', async () => {
        // Announcing a lockout tells an attacker the account exists, so the API answers it as it
        // answers a wrong password (ADR 0033 §1) — and the dialog must not tell the two apart by any
        // means of its own, such as counting the failures it has seen.
        const actor = quickActor();
        const api = await openSignIn();
        const said: string[] = [];

        await signIn(actor, 'alex', 'wrong');
        said.push((await screen.findByRole('alert')).textContent ?? '');
        for (let attempt = 2; attempt <= 5; attempt++) {
            await retryPassword(actor, `wrong${attempt}`);
            said.push(screen.getByRole('alert').textContent ?? '');
        }

        // Locked now: the right password is refused too, and in the same words.
        await retryPassword(actor, PASSWORD);
        said.push(screen.getByRole('alert').textContent ?? '');

        // Every attempt reached the API, so each sentence is its answer and none a leftover.
        const sent = api.callsTo('POST', '/api/auth/login').map(call => (call.body as { password: string }).password);
        expect(sent).toEqual(['wrong', 'wrong2', 'wrong3', 'wrong4', 'wrong5', PASSWORD]);
        expect(said).toEqual(Array(6).fill(REFUSED));
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
    });

    it('reads a rate-limited attempt by what the limiter said, not as a wrong password', async () => {
        // The ProblemDetails the limiter writes. Its `detail` is the sentence; "Login failed" in its
        // place is the misreading that made reading the body a rule.
        const actor = quickActor();
        await openSignIn({
            'POST /api/auth/login': () => json({
                type: 'https://tools.ietf.org/html/rfc6585#section-4',
                title: 'Too many requests',
                status: 429,
                detail: 'Too many attempts from this device. Wait a few minutes and try again.',
                traceId: '00-abc-def-00',
            }, 429),
        });

        await signIn(actor, 'alex');

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Too many attempts from this device. Wait a few minutes and try again.');
    });

    it('falls back to a plain sentence when the refusal has no body it can read', async () => {
        const actor = quickActor();
        await openSignIn({
            'POST /api/auth/login': () => new Response('<html>Bad gateway</html>', { status: 502 }),
        });

        await signIn(actor, 'alex');

        expect(await screen.findByRole('alert')).toHaveTextContent('Login failed');
    });

    it('stays open, signed out and saying so, when the API cannot be reached', async () => {
        const actor = quickActor();
        await openSignIn({ 'POST /api/auth/login': unreachable });

        await signIn(actor, 'alex');

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    it('says in its own words that the API could not be reached, not in the browser\'s', async () => {
        const actor = quickActor();
        await openSignIn({ 'POST /api/auth/login': unreachable });

        await signIn(actor, 'alex');

        expect(await screen.findByRole('alert')).not.toHaveTextContent('fetch failed');
    });
});

describe('AuthProvider registering', () => {
    it('registers through the write guard, and signs the new account in', async () => {
        const actor = quickActor();
        const api = await openSignUp();

        await signUp(actor, 'alex');

        expect(await screen.findByText('Signed in as alex')).toBeInTheDocument();
        expect(onClose).toHaveBeenCalledTimes(1);

        const [register] = api.callsTo('POST', '/api/auth/register');
        expect(register.body).toEqual({ email: 'alex@test.local', password: PASSWORD, userName: 'alex' });
        expectSentThroughApiFetch(register);
    });

    it("refuses a username shorter than UserNamePolicy's minimum without asking the API", async () => {
        const actor = quickActor();
        const api = await openSignUp();

        await signUp(actor, 'a'.repeat(USERNAME_MIN_LENGTH - 1));

        expect(screen.getByRole('alert'))
            .toHaveTextContent(`A username is ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long.`);
        expect(api.callsTo('POST', '/api/auth/register')).toHaveLength(0);
    });

    it("refuses a character outside UserNamePolicy's alphabet without asking the API", async () => {
        // Letters, digits and the underscore, and nothing else: no space, nothing that would let a
        // name pass for an address or a path, and no letter outside ASCII.
        const actor = quickActor();
        const api = await openSignUp();
        const [first, ...rest] = ['al ex', 'al-ex', 'al.ex', 'al@ex', 'al/ex', 'alé'];

        await signUp(actor, first);
        expect(screen.getByRole('alert'), first).toHaveTextContent('A username can use letters, numbers and underscores only.');
        for (const userName of rest) {
            await retryUserName(actor, userName);

            expect(screen.getByRole('alert'), userName)
                .toHaveTextContent('A username can use letters, numbers and underscores only.');
        }

        // None of them reached the API: a name let through would have been registered, and signed in.
        expect(api.callsTo('POST', '/api/auth/register')).toHaveLength(0);
    });

    it.each([
        ['the shortest', 'a_1'],
        ['the longest', 'Twenty_Characters_20'],
    ])('sends %s name the policy allows, letters of either case, digits and underscores in it', async (_, userName) => {
        expect(userName.length === USERNAME_MIN_LENGTH || userName.length === USERNAME_MAX_LENGTH).toBe(true);
        const actor = quickActor();
        const api = await openSignUp();

        await signUp(actor, userName);

        expect(await screen.findByText(`Signed in as ${userName}`)).toBeInTheDocument();
        expect(api.callsTo('POST', '/api/auth/register')[0].body).toMatchObject({ userName });
    });

    it('takes no more characters than the policy allows', async () => {
        const actor = quickActor();
        await openSignUp();

        await actor.type(screen.getByLabelText('Username'), 'abcdefghijklmnopqrstuvwxyz');

        expect(screen.getByLabelText('Username')).toHaveValue('abcdefghijklmnopqrstuvwxyz'.slice(0, USERNAME_MAX_LENGTH));
    });

    it('shows the refusals only the API can make: a name that is taken, and one that is reserved', async () => {
        // Availability is a question for the database and the reserved list lives on the server, so
        // both arrive as refusals — in Identity's shape and in a ValidationProblemDetails.
        const actor = quickActor();
        const answers = [
            json({ errors: ["Username 'alex' is already taken."] }, 400),
            json({
                title: 'One or more validation errors occurred.',
                status: 400,
                errors: { UserName: ['That username is reserved. Please choose another.'] },
            }, 400),
        ];
        await openSignUp({ 'POST /api/auth/register': () => answers.shift() ?? empty(500) });

        await signUp(actor, 'alex');
        expect(await screen.findByRole('alert')).toHaveTextContent("Username 'alex' is already taken.");

        await retryUserName(actor, 'admin');
        await waitFor(() => expect(screen.getByRole('alert'))
            .toHaveTextContent('That username is reserved. Please choose another.'));
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
    });

    it('shows every reason Identity gives, not only the first', async () => {
        // The form sets `noValidate`, so a weak password reaches Identity, which can refuse it on
        // several counts at once: in Identity's own words, for the length and the digit this API
        // requires.
        const actor = quickActor();
        await openSignUp({
            'POST /api/auth/register': () => json({
                errors: ['Passwords must be at least 8 characters.', "Passwords must have at least one digit ('0'-'9')."],
            }, 400),
        });

        await signUp(actor, 'alex');

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Passwords must be at least 8 characters.');
        expect(alert).toHaveTextContent("Passwords must have at least one digit ('0'-'9').");
    });

    it('stays open, signed out and saying so, when the API cannot be reached', async () => {
        const actor = quickActor();
        await openSignUp({ 'POST /api/auth/register': unreachable });

        await signUp(actor, 'alex');

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });
});

/**
 * What the profile details form sends, as typed: spaces round the name and a line ending a browser
 * sent as CRLF, which the server stores otherwise. Spread over the whole account, so a test can see
 * that nothing but the three fields leaves the provider.
 */
const TYPED_DETAILS: ProfileDetails = { ...ALEX, displayName: '  Alex ', avatarUrl: null, bio: 'Hi.\r\n' };

/**
 * The provider's five other writes, from the account settings page and the navbar, driven from a
 * stand-in for those pages. Their own suites mock `useAuth` too. A refused profile details save
 * lists its refusals by field, which is what the form puts beside each input.
 */
function AccountControls() {
    const auth = useAuth();
    const [said, setSaid] = useState<string | null>(null);
    const [refused, setRefused] = useState<Partial<Record<keyof ProfileDetails, string>>>({});
    const attempt = (write: () => Promise<void>) => () => {
        setSaid(null);
        setRefused({});
        write().catch((error: unknown) => {
            setSaid(error instanceof Error ? error.message : 'failed');
            if (error instanceof ProfileDetailsError) setRefused(error.fieldErrors);
        });
    };

    return (
        <>
            <button type="button" onClick={attempt(() => auth.updateUserName('alex_two'))}>Rename</button>
            <button type="button" onClick={attempt(() => auth.updateProfileVisibility('public'))}>Publish profile</button>
            <button type="button" onClick={attempt(() => auth.updateProfileDetails(TYPED_DETAILS))}>Save details</button>
            <button type="button" onClick={attempt(() => auth.deleteAccount(PASSWORD))}>Delete account</button>
            <button type="button" onClick={attempt(() => auth.logout())}>Sign out</button>
            {said !== null && <p role="alert">{said}</p>}
            <ul aria-label="Refused">
                {Object.entries(refused).map(([field, message]) => <li key={field}>{`${field}: ${message}`}</li>)}
            </ul>
            {auth.user !== null && (
                <p>{`Display name ${JSON.stringify(auth.user.displayName)}, bio ${JSON.stringify(auth.user.bio)}`}</p>
            )}
        </>
    );
}

async function renderSignedIn(routes: ApiRoutes) {
    const api = stubApi({ 'GET /api/auth/me': () => json(ALEX), ...routes });
    render(<AuthProvider><Session /><AccountControls /></AuthProvider>);
    await screen.findByText('Signed in as alex');
    return api;
}

describe('AuthProvider account writes', () => {
    it('shows the new name once the API has stored it', async () => {
        // The account page and the navbar build `/u/{name}` from what the provider holds.
        const actor = quickActor();
        await renderSignedIn({ 'PUT /api/user/username': () => json({ ...ALEX, userName: 'alex_two' }) });

        await actor.click(screen.getByRole('button', { name: 'Rename' }));

        expect(await screen.findByText('Signed in as alex_two')).toBeInTheDocument();
    });

    it("reads a refused rename by the field's own sentence, and keeps the name it had", async () => {
        // Taken, reserved and too soon all come back keyed by field; the title above them says nothing.
        const actor = quickActor();
        await renderSignedIn({
            'PUT /api/user/username': () => json({
                title: 'One or more validation errors occurred.',
                status: 400,
                errors: { UserName: ['You can change your username again on 14 November 2026.'] },
            }, 400),
        });

        await actor.click(screen.getByRole('button', { name: 'Rename' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('You can change your username again on 14 November 2026.');
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    });

    it('leaves nobody signed in after deleting the account, without a sign-out the API would refuse', async () => {
        const actor = quickActor();
        const api = await renderSignedIn({ 'DELETE /api/user': () => empty() });

        await actor.click(screen.getByRole('button', { name: 'Delete account' }));

        expect(await screen.findByText('Nobody is signed in')).toBeInTheDocument();
        const [deletion] = api.callsTo('DELETE', '/api/user');
        expect(deletion.body).toEqual({ password: PASSWORD });
        expectSentThroughApiFetch(deletion);
        expect(api.callsTo('POST', '/api/auth/logout')).toHaveLength(0);
    });

    it('keeps the session when the password does not confirm the deletion', async () => {
        const actor = quickActor();
        await renderSignedIn({ 'DELETE /api/user': () => json({ message: 'Password is incorrect.' }, 401) });

        await actor.click(screen.getByRole('button', { name: 'Delete account' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Password is incorrect.');
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    });

    it('saves exactly the three profile details, and shows them as the API stored them', async () => {
        // The answer is what the server stored, which is not what was typed: the account on screen
        // has to be the answer, or the form would disagree with the public page.
        const actor = quickActor();
        const api = await renderSignedIn({
            'PUT /api/user/profile': () => json({ ...ALEX, displayName: 'Alex', avatarUrl: null, bio: 'Hi.' }),
        });

        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        expect(await screen.findByText('Display name "Alex", bio "Hi."')).toBeInTheDocument();
        // Whatever else the object carried stays behind: the endpoint is told three things.
        expect(api.callsTo('PUT', '/api/user/profile')[0].body)
            .toEqual({ displayName: '  Alex ', avatarUrl: null, bio: 'Hi.\r\n' });
    });

    it('lists a refused save by field, whatever case the API keyed each in, and keeps what was stored', async () => {
        const actor = quickActor();
        await renderSignedIn({
            'PUT /api/user/profile': () => json({
                title: 'One or more validation errors occurred.',
                status: 400,
                errors: {
                    // As ASP.NET keys them, by the C# name.
                    DisplayName: ['A display name can be at most 50 characters.'],
                    AvatarUrl: ['An avatar has to be the address of a picture, starting https://.'],
                    // As a client might, and as nothing does yet.
                    bio: ['A bio can be at most 500 characters.'],
                    // A key naming no field — a body that would not parse, say — names nothing on the form.
                    '$.bio': ['The JSON value could not be converted.'],
                },
            }, 400),
        });

        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        const refused = within(await screen.findByRole('list', { name: 'Refused' }));
        await waitFor(() => expect(refused.getAllByRole('listitem')).toHaveLength(3));
        expect(refused.getAllByRole('listitem').map(item => item.textContent)).toEqual([
            'displayName: A display name can be at most 50 characters.',
            'avatarUrl: An avatar has to be the address of a picture, starting https://.',
            'bio: A bio can be at most 500 characters.',
        ]);
        expect(screen.getByText('Display name null, bio null')).toBeInTheDocument();
    });

    it("reads a refused save that names no field by the problem's own sentence", async () => {
        const actor = quickActor();
        await renderSignedIn({
            'PUT /api/user/profile': () => json({
                title: 'Bad Request',
                status: 400,
                detail: 'A non-empty request body is required.',
            }, 400),
        });

        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('A non-empty request body is required.');
        expect(within(screen.getByRole('list', { name: 'Refused' })).queryAllByRole('listitem')).toHaveLength(0);
    });

    it("says a lost race in its own words rather than Identity's", async () => {
        // The 409 a concurrent change to the account produces carries Identity's wording, which was
        // written for a log rather than for the person saving.
        const actor = quickActor();
        await renderSignedIn({
            'PUT /api/user/profile': () => json({
                title: 'Conflict',
                status: 409,
                detail: 'Optimistic concurrency failure, object has been modified.',
            }, 409),
        });

        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        expect(await screen.findByRole('alert'))
            .toHaveTextContent('Your account was changed somewhere else at the same moment. Please save again.');
    });

    it('falls back to a sentence of its own when a refused save has no body it can read', async () => {
        const actor = quickActor();
        await renderSignedIn({
            'PUT /api/user/profile': () => new Response('<html>Bad gateway</html>', { status: 502 }),
        });

        await actor.click(screen.getByRole('button', { name: 'Save details' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save your profile details.');
    });

    it('does not put an account back on screen when its save answers after the sign-out', async () => {
        // The save is still out when its owner signs out; its answer must not show them signed in
        // again, with no cookie behind it, to whoever uses the machine next (ADR 0022). The same
        // guard is on the rename and the privacy switch.
        const actor = quickActor();
        const save = held();
        await renderSignedIn({
            'PUT /api/user/profile': () => save.answer,
            'POST /api/auth/logout': () => empty(),
        });

        await actor.click(screen.getByRole('button', { name: 'Save details' }));
        await actor.click(screen.getByRole('button', { name: 'Sign out' }));
        await screen.findByText('Nobody is signed in');

        save.release(json({ ...ALEX, displayName: 'Alex' }));
        await settle();

        expect(screen.getByText('Nobody is signed in')).toBeInTheDocument();
    });

    it('keeps the session, and says so, when the API refuses to sign out', async () => {
        // Shown signed out while the cookie lives on, the reader leaves a shared computer signed in.
        const actor = quickActor();
        await renderSignedIn({ 'POST /api/auth/logout': () => empty(502) });

        await actor.click(screen.getByRole('button', { name: 'Sign out' }));

        expect(await screen.findByRole('alert')).toBeInTheDocument();
        expect(screen.getByText('Signed in as alex')).toBeInTheDocument();
    });
});

describe('AuthProvider and the write guard', () => {
    it('marks the other account writes as sent through apiFetch', async () => {
        // The API refuses a POST, PUT or DELETE without the header (ADR 0033); a write sent with
        // bare `fetch` is a 403 that looks like a bug. Signing in, registering and deleting the
        // account are asserted beside what they do, above; these are the other four.
        const actor = quickActor();
        const api = await renderSignedIn({
            'PUT /api/user/username': () => json({ ...ALEX, userName: 'alex_two' }),
            'PUT /api/user/privacy': () => json({ ...ALEX, userName: 'alex_two', profileVisibility: 'public' }),
            'PUT /api/user/profile': () => json({ ...ALEX, userName: 'alex_two', profileVisibility: 'public', displayName: 'Alex' }),
            'POST /api/auth/logout': () => empty(),
        });

        await actor.click(screen.getByRole('button', { name: 'Rename' }));
        await screen.findByText('Signed in as alex_two');
        await actor.click(screen.getByRole('button', { name: 'Publish profile' }));
        await waitFor(() => expect(api.callsTo('PUT', '/api/user/privacy')).toHaveLength(1));
        await actor.click(screen.getByRole('button', { name: 'Save details' }));
        await screen.findByText('Display name "Alex", bio null');
        await actor.click(screen.getByRole('button', { name: 'Sign out' }));
        await screen.findByText('Nobody is signed in');

        expect(api.writes().map(call => `${call.method} ${call.path}`)).toEqual([
            'PUT /api/user/username',
            'PUT /api/user/privacy',
            'PUT /api/user/profile',
            'POST /api/auth/logout',
        ]);
        for (const write of api.writes()) expectSentThroughApiFetch(write);
    });
});
