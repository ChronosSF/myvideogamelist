import { createContext } from 'react';

/** The two ways in: signing in to an account, or making one. */
export type AuthDialog = 'login' | 'signup';

export interface AuthDialogContextValue {
    /** Opens the dialog, over whichever one is open. */
    open: (dialog: AuthDialog) => void;
}

export const AuthDialogContext = createContext<AuthDialogContextValue | null>(null);
