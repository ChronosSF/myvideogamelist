import { createContext } from 'react';
import type { ProfileDetails, ProfileVisibility, RegisterResult, UserProfile } from '@/types/auth';
import type { Look } from '@/types/look';

export interface AuthContextValue {
    user: UserProfile | null;
    loading: boolean;
    /**
     * Signs in. Rejects with an `UnconfirmedEmailError` when the password is right and the address is
     * not confirmed yet, and with the server's message otherwise.
     */
    login: (email: string, password: string, rememberMe: boolean) => Promise<void>;
    /**
     * Makes an account and asks for its confirmation to be sent. Signs nobody in: an account signs in
     * once its address is confirmed (ADR 0089). `turnstileToken` is what Cloudflare's check handed the
     * form, spent by this one attempt (ADR 0092).
     */
    register: (email: string, password: string, userName: string, turnstileToken: string) => Promise<RegisterResult>;
    /**
     * Asks for the confirmation to be sent again to an account waiting for it, by its address or its
     * username. Resolves the same whether or not anything was sent: the API says nothing more.
     */
    resendConfirmation: (emailOrUserName: string) => Promise<void>;
    /** Confirms an address from the two halves of its link. Signs nobody in. */
    confirmEmail: (userId: string, token: string) => Promise<void>;
    /**
     * Asks for the link that sets a new password, for the account an address or a username names.
     * Resolves the same whether or not an account goes by it, and whether or not one was sent a link in
     * the last few minutes: the API says nothing more (ADR 0090).
     */
    requestPasswordReset: (emailOrUserName: string) => Promise<void>;
    /**
     * Sets a new password from the two halves of a reset link. Signs nobody in, and ends every session
     * the account had, this browser's included. Rejects with an `InvalidResetLinkError` when the link is no
     * good, and with the API's sentences when the password is refused, which leaves the link working.
     */
    resetPassword: (userId: string, token: string, password: string) => Promise<void>;
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
     * Replaces the account's look, all of it at once, and takes the account back with it as stored.
     * Rejects with the server's message.
     */
    updateLook: (look: Look) => Promise<void>;
    /**
     * Deletes the account and everything in it, confirmed by its password, and leaves nobody signed
     * in. Rejects with the server's message — a wrong password is a sentence for the user — and
     * leaves the session exactly as it was.
     */
    deleteAccount: (password: string) => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
