import { useEffect, useState, type ReactNode } from 'react';
import type { ProfileVisibility, UserProfile } from '@/types/auth';
import { AuthContext } from './AuthContext';

function applyTheme(theme: 'dark' | 'light') {
    document.documentElement.setAttribute('data-theme', theme);
}

/**
 * The message a failed write should show the user.
 *
 * ASP.NET returns three shapes and they are not interchangeable. `ValidationProblemDetails` puts
 * the useful sentence inside `errors`, keyed by field — that is what the username endpoint returns
 * for "taken", "reserved" and "too soon", and reading only `message` would show a generic failure
 * in place of the one thing the user needs to know. `{ errors: [...] }` is Identity's own shape,
 * used by registration. `{ message }` is everything else.
 */
async function problem(response: Response, fallback: string): Promise<string> {
    try {
        const body: unknown = await response.json();
        if (typeof body !== 'object' || body === null) return fallback;

        const { errors, message } = body as { errors?: unknown; message?: unknown };

        if (Array.isArray(errors)) return errors.join(' ') || fallback;

        if (typeof errors === 'object' && errors !== null) {
            const first = Object.values(errors as Record<string, unknown>)
                .flatMap(value => (Array.isArray(value) ? (value as string[]) : []))
                .find(text => typeof text === 'string' && text.length > 0);
            if (first) return first;
        }

        return typeof message === 'string' && message.length > 0 ? message : fallback;
    } catch {
        // A body that is not JSON at all — a proxy error page, or an empty 500.
        return fallback;
    }
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/auth/me', { credentials: 'include' })
            .then(res => (res.ok ? res.json() : null))
            .then((data: UserProfile | null) => {
                setUser(data);
                applyTheme(data?.theme ?? 'dark');
            })
            .finally(() => setLoading(false));
    }, []);

    const login = async (email: string, password: string, rememberMe: boolean) => {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password, rememberMe }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Login failed'));

        const data: UserProfile = await res.json();
        setUser(data);
        applyTheme(data.theme);
    };

    const register = async (email: string, password: string, userName: string) => {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password, userName }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Registration failed'));

        const data: UserProfile = await res.json();
        setUser(data);
        applyTheme(data.theme);
    };

    const logout = async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        setUser(null);
        applyTheme('dark');
    };

    const updateTheme = async (theme: 'dark' | 'light') => {
        const res = await fetch('/api/user/theme', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ theme }),
        });
        if (!res.ok) throw new Error('Failed to update theme');
        setUser(prev => (prev ? { ...prev, theme } : null));
        applyTheme(theme);
    };

    /**
     * Both of these take the whole profile back from the server rather than patching the field
     * they sent. A rename can be normalised on the way through — and a settings page that showed
     * what was typed rather than what was stored would disagree with the URL it just built.
     */
    const updateUserName = async (userName: string) => {
        const res = await fetch('/api/user/username', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ userName }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Failed to change your username'));

        setUser(await res.json() as UserProfile);
    };

    const updateProfileVisibility = async (profileVisibility: ProfileVisibility) => {
        const res = await fetch('/api/user/privacy', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ profileVisibility }),
        });
        if (!res.ok) throw new Error(await problem(res, 'Failed to change your profile visibility'));

        setUser(await res.json() as UserProfile);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                loading,
                login,
                register,
                logout,
                updateTheme,
                updateUserName,
                updateProfileVisibility,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}
