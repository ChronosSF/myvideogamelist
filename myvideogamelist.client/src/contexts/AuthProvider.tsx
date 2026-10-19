import { useEffect, useState, type ReactNode } from 'react';
import {
    ProfileDetailsError,
    type ProfileDetails,
    type ProfileVisibility,
    type UserProfile,
} from '@/types/auth';
import { apiFetch } from '@/lib/api';
import { AuthContext } from './AuthContext';

/**
 * A failed response's body, or null when it is not JSON at all — a proxy error page, or an empty
 * 500. Read once, because a body can only be read once.
 */
async function bodyOf(response: Response): Promise<unknown> {
    try {
        return await response.json();
    } catch {
        return null;
    }
}

/**
 * The message a failed write should show the user, from the body it answered with.
 *
 * ASP.NET returns three shapes and they are not interchangeable. `ValidationProblemDetails` puts
 * the useful sentence inside `errors`, keyed by field — that is what the username endpoint returns
 * for "taken", "reserved" and "too soon", and reading only `message` would show a generic failure
 * in place of the one thing the user needs to know. `{ errors: [...] }` is Identity's own shape,
 * used by registration. `{ message }` is what this API's own auth failures carry, and `detail` or
 * `title` alone is a plain `ProblemDetails` — a rate-limited login, or anything the framework
 * answers before a controller runs.
 */
function messageIn(body: unknown, fallback: string): string {
    if (typeof body !== 'object' || body === null) return fallback;

    const { errors, message, detail, title } = body as {
        errors?: unknown;
        message?: unknown;
        detail?: unknown;
        title?: unknown;
    };

    if (Array.isArray(errors)) return errors.join(' ') || fallback;

    if (typeof errors === 'object' && errors !== null) {
        const first = Object.values(errors as Record<string, unknown>)
            .flatMap(value => (Array.isArray(value) ? (value as string[]) : []))
            .find(text => typeof text === 'string' && text.length > 0);
        if (first) return first;
    }

    // `message` is what this API's own auth failures carry. `detail` and `title` are
    // ProblemDetails, which is what the framework produces - a rate-limited login being the
    // one where the fallback ("Login failed") would be actively misleading.
    for (const candidate of [message, detail, title]) {
        if (typeof candidate === 'string' && candidate.length > 0) return candidate;
    }

    return fallback;
}

async function problem(response: Response, fallback: string): Promise<string> {
    return messageIn(await bodyOf(response), fallback);
}

const DETAIL_FIELDS = ['displayName', 'avatarUrl', 'bio'] as const;

/**
 * A refused save of the profile details, with the server's reason for each field it refused keyed
 * by that field. ASP.NET keys them by the C# name — `DisplayName` — so they are matched without case.
 */
async function detailsProblem(response: Response): Promise<ProfileDetailsError> {
    const body = await bodyOf(response);
    const fieldErrors: Partial<Record<keyof ProfileDetails, string>> = {};

    const errors = typeof body === 'object' && body !== null
        ? (body as { errors?: unknown }).errors
        : undefined;

    if (typeof errors === 'object' && errors !== null && !Array.isArray(errors)) {
        for (const [key, messages] of Object.entries(errors as Record<string, unknown>)) {
            const field = DETAIL_FIELDS.find(name => name.toLowerCase() === key.toLowerCase());
            const first = Array.isArray(messages)
                ? messages.find((text): text is string => typeof text === 'string' && text.length > 0)
                : undefined;
            if (field !== undefined && first !== undefined) fieldErrors[field] = first;
        }
    }

    // A 409 is a lost race with another change to the account — the privacy switch flipped during
    // the save, or a second tab — and its detail is Identity's own wording, written for a log.
    const message = response.status === 409
        ? 'Your account was changed somewhere else at the same moment. Please save again.'
        : messageIn(body, 'Failed to save your profile details.');

    return new ProfileDetailsError(message, fieldErrors);
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    // Abandoned on cleanup, as the other providers' reads are, and for a reason that comes up far
    // more often than an unmount: since React 19.3, Strict Mode runs a hydrated tree's effects twice
    // in development, cleaning up in between, as it already did for a client-rendered one — so this
    // runs twice on every page load. Without the abort both answers would land, and the second
    // would replace `user` with an equal object, which the lists, the wishlist and the favourites
    // each take as a reason to fetch again.
    useEffect(() => {
        const controller = new AbortController();

        fetch('/api/auth/me', { credentials: 'include', signal: controller.signal })
            .then(res => (res.ok ? res.json() : null))
            .then((data: UserProfile | null) => {
                if (!controller.signal.aborted) setUser(data);
            })
            // An unreachable API rejects rather than answering, and means nobody signed in just as a
            // refusal does. The abort lands here too, and is dropped.
            .catch(() => {
                if (!controller.signal.aborted) setUser(null);
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });

        return () => controller.abort();
    }, []);

    const login = async (email: string, password: string, rememberMe: boolean) => {
        const res = await apiFetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, rememberMe }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Login failed'));

        setUser(await res.json() as UserProfile);
    };

    const register = async (email: string, password: string, userName: string) => {
        const res = await apiFetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, userName }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Registration failed'));

        setUser(await res.json() as UserProfile);
    };

    const logout = async () => {
        await apiFetch('/api/auth/logout', { method: 'POST' });
        setUser(null);
    };

    /**
     * Takes the account a profile change answered with, but only while it is still the account on
     * screen. A change can be in flight when its owner signs out, or out and back in as somebody
     * else, and its answer landing then would put the first account back on screen with no cookie
     * behind it, or over the second's — whose lists would then load under the first one's name.
     * Compared inside the updater, against state, never against a ref (ADR 0022).
     */
    const acceptProfile = (next: UserProfile) =>
        setUser(current => (current !== null && current.id === next.id ? next : current));

    /**
     * Each of these takes the whole profile back from the server rather than patching the field it
     * sent. A rename can be normalised on the way through — and a settings page that showed what was
     * typed rather than what was stored would disagree with the URL it just built.
     */
    const updateUserName = async (userName: string) => {
        const res = await apiFetch('/api/user/username', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userName }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Failed to change your username'));

        acceptProfile(await res.json() as UserProfile);
    };

    const updateProfileVisibility = async (profileVisibility: ProfileVisibility) => {
        const res = await apiFetch('/api/user/privacy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileVisibility }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Failed to change your profile visibility'));

        acceptProfile(await res.json() as UserProfile);
    };

    /**
     * Sends exactly the three fields, whatever else the object handed in carries, and takes the
     * profile back as stored — trimmed, its line endings folded — so the form shows what the public
     * page will.
     */
    const updateProfileDetails = async ({ displayName, avatarUrl, bio }: ProfileDetails) => {
        const res = await apiFetch('/api/user/profile', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ displayName, avatarUrl, bio }),
        });
        if (!res.ok) throw await detailsProblem(res);

        acceptProfile(await res.json() as UserProfile);
    };

    /**
     * Signed out by the server as part of the same request, so the only thing left to do here is
     * forget the user — calling `logout` as well would spend a request on a guaranteed 401. Clearing
     * `user` is also what empties the list and wishlist providers, which reset on the transition.
     */
    const deleteAccount = async (password: string) => {
        const res = await apiFetch('/api/user', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Failed to delete your account'));

        setUser(null);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                login,
                register,
                logout,
                updateUserName,
                updateProfileVisibility,
                updateProfileDetails,
                deleteAccount,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
