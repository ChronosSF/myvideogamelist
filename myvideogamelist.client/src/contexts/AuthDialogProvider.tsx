import { useMemo, useState, type ReactNode } from 'react';
import { ForgotPasswordDialog } from '@/components/ForgotPasswordDialog';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { AuthDialogContext, type AuthDialog, type AuthDialogContextValue } from './AuthDialogContext';

/**
 * The sign-in, sign-up and forgotten-password dialogs, which anything on the page may open: the navbar's
 * buttons, the home page's welcome panel, and the pages an email's link opens. One set for the whole page,
 * so no two are ever open at once.
 */
export function AuthDialogProvider({ children }: { children: ReactNode }) {
    const [dialog, setDialog] = useState<AuthDialog | null>(null);
    // What the sign-in dialog held when "Forgot password?" was pressed, so it need not be typed twice.
    const [identifier, setIdentifier] = useState('');

    // Stable, so a consumer's effect that depends on it never re-runs for a dialog opening.
    const value = useMemo<AuthDialogContextValue>(() => ({
        open: next => {
            setIdentifier('');
            setDialog(next);
        },
    }), []);

    return (
        <AuthDialogContext.Provider value={value}>
            {children}

            {dialog === 'login' && (
                <LoginDialog
                    onClose={() => setDialog(null)}
                    onSwitchToRegister={() => setDialog('signup')}
                    onForgotPassword={typed => {
                        setIdentifier(typed);
                        setDialog('forgot-password');
                    }}
                />
            )}
            {dialog === 'signup' && (
                <SignupDialog
                    onClose={() => setDialog(null)}
                    onSwitchToLogin={() => setDialog('login')}
                />
            )}
            {dialog === 'forgot-password' && (
                <ForgotPasswordDialog
                    initialEmailOrUserName={identifier}
                    onClose={() => setDialog(null)}
                    onSwitchToLogin={() => setDialog('login')}
                />
            )}
        </AuthDialogContext.Provider>
    );
}
