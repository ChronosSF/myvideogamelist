import { SUPPORT_EMAIL } from '@/lib/links';
import { ResendConfirmation } from './ResendConfirmation';

interface Props {
    /** The address the account was made with, and the confirmation went to. */
    email: string;
    /** Whether the confirmation went. False means the account is made and the email is not sent. */
    emailSent: boolean;
    /** The id the dialog is labelled by, which this heading takes over from the form's. */
    titleId: string;
    onSwitchToLogin: () => void;
}

/**
 * What a new account sees in place of the sign-up form: where its confirmation went, and a way to have
 * it sent again. Nobody is signed in yet: an account signs in once its address is confirmed (ADR 0089).
 */
export function CheckYourInbox({ email, emailSent, titleId, onSwitchToLogin }: Props) {
    return (
        <>
            <h2 id={titleId} className="dialog-title">{emailSent ? 'Check your inbox' : 'Your account is ready'}</h2>
            {emailSent ? (
                <div className="dialog-text">
                    <p>
                        We sent a link to <strong>{email}</strong>. Open it to confirm your address, then
                        sign in.
                    </p>
                    <p>
                        It can take a minute to arrive. If it does not, look in your spam folder. Still nothing?
                        Write to{' '}
                        <a href={`mailto:${SUPPORT_EMAIL}`} className="text-link">{SUPPORT_EMAIL}</a>.
                    </p>
                </div>
            ) : (
                <div className="dialog-error" role="alert">
                    We made your account, but the email that confirms your address did not go. Send it again
                    below.
                </div>
            )}
            <ResendConfirmation emailOrUserName={email} />
            <div className="dialog-footer">
                Confirmed already?{' '}
                <button type="button" onClick={onSwitchToLogin}>
                    Sign In
                </button>
            </div>
        </>
    );
}
