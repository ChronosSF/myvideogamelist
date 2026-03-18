import { useEffect, useState, type ReactNode } from 'react';
import type { UserProfile } from '@/types/auth';
import { AuthContext } from './AuthContext';

function applyTheme(theme: 'dark' | 'light') {
    document.documentElement.setAttribute('data-theme', theme);
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
        if (!res.ok) {
            const data = await res.json();
            throw new Error((data as { message?: string }).message ?? 'Login failed');
        }
        const data: UserProfile = await res.json();
        setUser(data);
        applyTheme(data.theme);
    };

    const register = async (email: string, password: string) => {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ email, password }),
        });
        if (!res.ok) {
            const data = await res.json();
            const errs = (data as { errors?: string[] }).errors;
            throw new Error(errs ? errs.join(' ') : 'Registration failed');
        }
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

    return (
        <AuthContext.Provider value={{ user, loading, login, register, logout, updateTheme }}>
            {children}
        </AuthContext.Provider>
    );
}
