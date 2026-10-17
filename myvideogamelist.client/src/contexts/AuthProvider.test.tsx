import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useAuth } from '@/hooks/useAuth';
import { AuthProvider } from '@/contexts/AuthProvider';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { REQUEST_HEADER } from '@/lib/api';
import { ProfileDetailsError } from '@/types/auth';
import { userProfile } from '@/test/factories';

/**
 * The real provider over a stubbed `fetch`: these are about what goes over the wire and what comes
 * back out of a refusal, which a mocked `useAuth` would skip.
 */
let auth: AuthContextValue | null = null;

/** Hands the provider's latest value out after each commit, which is when it is the real one. */
function Capture() {
    const value = useAuth();
    useEffect(() => {
        auth = value;
    });
    return null;
}

const SIGNED_IN = userProfile({ id: 'user-1', userName: 'alex' });

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * `/api/auth/me` answers with the account, signing out answers with nothing, and the profile save
 * answers with whatever the test says — when the test says.
 */
function stubFetch(save: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/api/auth/me')) return json(200, SIGNED_IN);
        if (url.endsWith('/api/auth/logout')) return new Response(null, { status: 204 });
        if (url.endsWith('/api/user/profile')) return save();
        throw new Error(`unexpected fetch: ${url}`);
    });

    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function renderSignedIn() {
    render(<AuthProvider><Capture /></AuthProvider>);
    await waitFor(() => expect(auth?.user?.id).toBe('user-1'));
    return auth!;
}

beforeEach(() => {
    vi.unstubAllGlobals();
    auth = null;
});

describe('AuthProvider.updateProfileDetails', () => {
    it('puts exactly the three fields, as a write, and takes the stored account back', async () => {
        // The server answers with what it stored, which is not what was sent: the account on screen
        // has to be the answer.
        const stored = { ...SIGNED_IN, displayName: 'Alex', avatarUrl: null, bio: 'Hi.' };
        const fetchMock = stubFetch(() => json(200, stored));
        const signedIn = await renderSignedIn();

        await act(() => signedIn.updateProfileDetails({
            ...SIGNED_IN,
            displayName: '  Alex ',
            avatarUrl: null,
            bio: 'Hi.\r\n',
        }));

        const [, init] = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/api/user/profile'))!;
        expect(init?.method).toBe('PUT');
        // The write guard refuses anything without it (ADR 0033).
        expect(new Headers(init?.headers).get(REQUEST_HEADER)).toBe('1');
        // Whatever else the object carried stays behind: the endpoint is told three things.
        expect(JSON.parse(String(init?.body))).toEqual({ displayName: '  Alex ', avatarUrl: null, bio: 'Hi.\r\n' });

        expect(auth?.user?.displayName).toBe('Alex');
        expect(auth?.user?.bio).toBe('Hi.');
    });

    it('rejects with each refusal keyed by its field, whatever case the server keyed it in', async () => {
        stubFetch(() => json(400, {
            title: 'One or more validation errors occurred.',
            status: 400,
            errors: {
                // As ASP.NET keys them, by the C# name.
                DisplayName: ['A display name can be at most 50 characters.'],
                AvatarUrl: ['An avatar has to be the address of a picture, starting https://.'],
                // As a client might, and as nothing does yet.
                bio: ['A bio can be at most 500 characters.'],
                // A key naming no field: the body would not parse, say. It names nothing on the form.
                '$.bio': ['The JSON value could not be converted.'],
            },
        }));
        const signedIn = await renderSignedIn();

        const failure = await signedIn
            .updateProfileDetails({ displayName: 'x'.repeat(60), avatarUrl: 'ftp://a', bio: 'x'.repeat(600) })
            .catch((err: unknown) => err);

        expect(failure).toBeInstanceOf(ProfileDetailsError);
        expect((failure as ProfileDetailsError).fieldErrors).toEqual({
            displayName: 'A display name can be at most 50 characters.',
            avatarUrl: 'An avatar has to be the address of a picture, starting https://.',
            bio: 'A bio can be at most 500 characters.',
        });
        // Nothing was saved, so the account on screen is the one that was there.
        expect(auth?.user?.displayName).toBeNull();
    });

    it('rejects with the problem\'s own sentence when no field is named', async () => {
        stubFetch(() => json(400, {
            title: 'Bad Request',
            status: 400,
            detail: 'A non-empty request body is required.',
        }));
        const signedIn = await renderSignedIn();

        const failure = await signedIn
            .updateProfileDetails({ displayName: 'Alex', avatarUrl: null, bio: null })
            .catch((err: unknown) => err);

        expect(failure).toBeInstanceOf(ProfileDetailsError);
        expect((failure as ProfileDetailsError).fieldErrors).toEqual({});
        expect((failure as ProfileDetailsError).message).toBe('A non-empty request body is required.');
    });

    it('says a lost race in its own words rather than Identity\'s', async () => {
        // The 409 a concurrent change to the account produces carries Identity's wording, which was
        // written for a log rather than for the person saving.
        stubFetch(() => json(409, {
            title: 'Conflict',
            status: 409,
            detail: 'Optimistic concurrency failure, object has been modified.',
        }));
        const signedIn = await renderSignedIn();

        const failure = await signedIn
            .updateProfileDetails({ displayName: 'Alex', avatarUrl: null, bio: null })
            .catch((err: unknown) => err);

        expect((failure as ProfileDetailsError).message)
            .toBe('Your account was changed somewhere else at the same moment. Please save again.');
    });

    it('does not put an account back on screen once its owner has signed out', async () => {
        // The save is still out when the owner signs out; its answer must not sign them back in on
        // screen, with no cookie behind it, for whoever uses the machine next (ADR 0022).
        let answer: (response: Response) => void = () => {};
        stubFetch(() => new Promise<Response>(resolve => { answer = resolve; }));
        const signedIn = await renderSignedIn();

        const saving = signedIn.updateProfileDetails({ displayName: 'Alex', avatarUrl: null, bio: null });
        await act(() => signedIn.logout());
        expect(auth?.user).toBeNull();

        await act(async () => {
            answer(json(200, { ...SIGNED_IN, displayName: 'Alex' }));
            await saving;
        });

        expect(auth?.user).toBeNull();
    });

    it('rejects with a sentence of its own when the body is not a problem at all', async () => {
        stubFetch(() => new Response('<html>Bad gateway</html>', { status: 502 }));
        const signedIn = await renderSignedIn();

        const failure = await signedIn
            .updateProfileDetails({ displayName: 'Alex', avatarUrl: null, bio: null })
            .catch((err: unknown) => err);

        expect((failure as ProfileDetailsError).message).toBe('Failed to save your profile details.');
    });
});
