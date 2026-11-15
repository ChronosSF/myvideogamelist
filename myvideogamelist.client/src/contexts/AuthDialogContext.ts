import { createContext } from 'react';

/** The ways in: signing in to an account, making one, or asking for a forgotten password's link. */
export type AuthDialog = 'login' | 'signup' | 'forgot-password';

export interface AuthDialogContextValue {
    /** Opens the dialog, over whichever one is open. */
    open: (dialog: AuthDialog) => void;
}

export const AuthDialogContext = createContext<AuthDialogContextValue | null>(null);
