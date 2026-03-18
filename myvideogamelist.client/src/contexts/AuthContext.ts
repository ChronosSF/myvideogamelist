import { createContext } from 'react';
import type { UserProfile } from '@/types/auth';

export interface AuthContextValue {
    user: UserProfile | null;
    loading: boolean;
    login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    updateTheme: (theme: 'dark' | 'light') => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
