import { createContext } from 'react';
import type { ProfileDetails, ProfileVisibility, UserProfile } from '@/types/auth';

export interface AuthContextValue {
    user: UserProfile | null;
    loading: boolean;
    login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
    register: (email: string, password: string, userName: string) => Promise<void>;
    logout: () => Promise<void>;
    /**
     * Claims a different username. Rejects with the server's message — taken, reserved, or too
     * soon after the last change — because every one of those is a sentence written for the user.
     */
    updateUserName: (userName: string) => Promise<void>;
    /** Turns the public profile at `/u/{userName}` on or off. */
    updateProfileVisibility: (visibility: ProfileVisibility) => Promise<void>;
    /**
     * Replaces the display name, the avatar and the bio, all three at once; a null clears one.
     * Rejects with a `ProfileDetailsError`, whose `fieldErrors` hold the server's reason for each
     * field it refused, so the form can show each beside its input.
     */
    updateProfileDetails: (details: ProfileDetails) => Promise<void>;
    /**
     * Deletes the account and everything in it, confirmed by its password, and leaves nobody signed
     * in. Rejects with the server's message — a wrong password is a sentence for the user — and
     * leaves the session exactly as it was.
     */
    deleteAccount: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
