import { useMemo, useState, type ReactNode } from 'react';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { AuthDialogContext, type AuthDialog, type AuthDialogContextValue } from './AuthDialogContext';

/**
 * The sign-in and sign-up dialogs, which anything on the page may open: the navbar's buttons, and the home
 * page's welcome panel. One pair for the whole page, so the two never open a dialog each.
 */
export function AuthDialogProvider({ children }: { children: ReactNode }) {
    const [dialog, setDialog] = useState<AuthDialog | null>(null);

    // Stable, so a consumer's effect that depends on it never re-runs for a dialog opening.
    const value = useMemo<AuthDialogContextValue>(() => ({ open: setDialog }), []);

    return (
        <AuthDialogContext.Provider value={value}>
            {children}

            {dialog === 'login' && (
                <LoginDialog
                    onClose={() => setDialog(null)}
                    onSwitchToRegister={() => setDialog('signup')}
                />
            )}
            {dialog === 'signup' && (
                <SignupDialog
                    onClose={() => setDialog(null)}
                    onSwitchToLogin={() => setDialog('login')}
                />
            )}
        </AuthDialogContext.Provider>
    );
}
