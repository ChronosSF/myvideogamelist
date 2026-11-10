import { useMemo, useState, type ReactNode } from 'react';
import { ForgotPasswordDialog } from '@/components/ForgotPasswordDialog';
import { LoginDialog } from '@/components/LoginDialog';
import { SignupDialog } from '@/components/SignupDialog';
import { AuthDialogContext, type AuthDialog, type AuthDialogContextValue } from './AuthDialogContext';

/**
 * The open dialog, and what it opened with: the forgotten-password dialog carries what the sign-in dialog
 * held, so that it need not be typed twice. One value, so that no way of opening a dialog can leave an
 * earlier one's text behind.
 */
type Open = { kind: AuthDialog; emailOrUserName?: string };

/**
 * The sign-in, sign-up and forgotten-password dialogs, which anything on the page may open: the navbar's
 * buttons, the home page's welcome panel, and the pages an email's link opens. One set for the whole page,
 * so no two are ever open at once.
 */
export function AuthDialogProvider({ children }: { children: ReactNode }) {
    const [dialog, setDialog] = useState<Open | null>(null);

    // Stable, so a consumer's effect that depends on it never re-runs for a dialog opening.
    const value = useMemo<AuthDialogContextValue>(() => ({ open: kind => setDialog({ kind }) }), []);
    const close = () => setDialog(null);

    return (
        <AuthDialogContext.Provider value={value}>
            {children}

            {dialog?.kind === 'login' && (
                <LoginDialog
                    onClose={close}
                    onSwitchToRegister={() => setDialog({ kind: 'signup' })}
                    onForgotPassword={emailOrUserName => setDialog({ kind: 'forgot-password', emailOrUserName })}
                />
            )}
            {dialog?.kind === 'signup' && (
                <SignupDialog onClose={close} onSwitchToLogin={() => setDialog({ kind: 'login' })} />
            )}
            {dialog?.kind === 'forgot-password' && (
                <ForgotPasswordDialog
                    initialEmailOrUserName={dialog.emailOrUserName ?? ''}
                    onClose={close}
                    onSwitchToLogin={() => setDialog({ kind: 'login' })}
                />
            )}
        </AuthDialogContext.Provider>
    );
}
