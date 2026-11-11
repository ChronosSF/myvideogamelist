import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { SUPPORT_EMAIL } from '@/lib/links';

interface Props {
    /** The address or the username the account is known by, as signing in accepts either. */
    emailOrUserName: string;
}

/**
 * A button that asks for an account's confirmation link to be sent again, and what came of asking.
 *
 * What it says once asked is hedged on purpose. The API answers every request the same, whether or not
 * an account is waiting and whether or not one was sent a link in the last few minutes, so that nobody
 * can use it to learn either (ADR 0089). The sentence is true in every one of those cases.
 *
 * It ends with the support address, wherever it is shown. SES sends nothing to an address that once
 * bounced or complained, and tells the API nothing about it (ADR 0091), so pressing the button again
 * cannot help such a person. Only somebody who can lift the address can.
 */
export function ResendConfirmation({ emailOrUserName }: Props) {
    const { resendConfirmation } = useAuth();
    const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
    const [error, setError] = useState<string | null>(null);

    const send = async () => {
        setState('sending');
        setError(null);
        try {
            await resendConfirmation(emailOrUserName);
            setState('sent');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send the link again. Please try again.');
            setState('idle');
        }
    };

    return (
        <div className="mb-4">
            <button
                type="button"
                className="dialog-btn-secondary w-full"
                onClick={() => void send()}
                disabled={state === 'sending'}
            >
                {state === 'sending' ? 'Sending…' : 'Send the link again'}
            </button>
            <p role="status" className="dialog-hint mt-2 empty:mt-0">
                {state === 'sent'
                    ? 'If the account is waiting for its confirmation, a new link is on its way. We send one every few minutes at most.'
                    : ''}
            </p>
            {error && <div className="dialog-error mt-2" role="alert">{error}</div>}
            <p className="dialog-hint mt-2">
                Still nothing? Write to{' '}
                <a href={`mailto:${SUPPORT_EMAIL}`} className="text-link">{SUPPORT_EMAIL}</a>.
            </p>
        </div>
    );
}
