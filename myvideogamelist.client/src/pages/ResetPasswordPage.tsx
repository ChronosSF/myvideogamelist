import { type ReactNode, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { NewPasswordForm } from '@/components/NewPasswordForm';
import { SkeletonLine } from '@/components/SkeletonLine';
import { useAuth } from '@/hooks/useAuth';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import { type AccountLink, forgetFragment, linkIn, useFragment } from '@/lib/accountLink';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import { InvalidResetLinkError } from '@/types/auth';

/** One person's link, so never cacheable. Declared rather than inherited from the root. */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'Choose a new password - MyVideoGameList' },
        { name: 'description', content: 'Choose a new password for your MyVideoGameList account.' },
        NOINDEX,
    ];
}

/** What became of one link, by its token, so that a newer link is never shown an older one's answer. */
type Outcome = { token: string } & ({ kind: 'changed' } | { kind: 'refused'; message: string });

/**
 * Where the link in a password reset email leads (ADR 0090).
 *
 * The account and its token are in the fragment, as a confirmation's are (ADR 0089), and read once the
 * page runs in the browser. Unlike the confirmation page, this one takes them out of the address bar as
 * soon as it has read them, before anything is typed: a reset link left in the address bar, or in the
 * tab's back and forward entries, sets the password of the account, for its hour, for whoever uses that
 * browser next. So a reload finds no link, and opening it from the email again works, since only a reset
 * spends it.
 *
 * Resetting signs nobody in. It ends every session the account had, and the page offers the sign-in.
 */
export default function ResetPasswordPage() {
    const { resetPassword } = useAuth();
    const authDialog = useAuthDialog();
    const fragment = useFragment();
    const inAddress = fragment === null ? null : linkIn(fragment);
    // The link once read, kept after the page has taken it out of the address bar.
    const [held, setHeld] = useState<AccountLink | null>(null);
    const [outcome, setOutcome] = useState<Outcome | null>(null);

    // A link in the address bar that the page does not hold yet, the first or a newer one opened in the
    // same tab, is taken during render, React's pattern for state that follows something outside it. So
    // every render React commits holds the link the address bar had, and nothing reads the address again.
    if (inAddress !== null && inAddress.token !== held?.token) setHeld(inAddress);
    const link = held;

    // Out of the address bar whenever it carries a link, a second one opened in the same tab included.
    useEffect(() => {
        if (fragment !== null && linkIn(fragment) !== null) forgetFragment();
    }, [fragment]);

    const askAgain = (
        <button type="button" className="btn-primary px-5 py-2.5" onClick={() => authDialog.open('forgot-password')}>
            Ask for a new link
        </button>
    );

    const settled = outcome !== null && link !== null && link.token === outcome.token ? outcome : null;

    // The form's button gives way to the outcome, and focus would fall to the page's body with it. The
    // outcome is where it goes instead, which is also what a screen reader then reads.
    const outcomeRef = useRef<HTMLDivElement>(null);
    const settledKind = settled?.kind;
    useEffect(() => {
        if (settledKind !== undefined) outcomeRef.current?.focus();
    }, [settledKind]);

    let body: ReactNode;
    if (settled?.kind === 'changed') {
        body = (
            <div className="space-y-5" role="status">
                <p className="text-fg-soft leading-relaxed">
                    Your password is changed, and you are signed out everywhere you were signed in. Sign in with
                    the new one.
                </p>
                <button type="button" className="btn-primary px-5 py-2.5" onClick={() => authDialog.open('login')}>
                    Sign in
                </button>
            </div>
        );
    } else if (settled?.kind === 'refused') {
        body = (
            <ErrorState title="That link did not work" size="section">
                <p>{settled.message}</p>
                <div className="mt-4">{askAgain}</div>
            </ErrorState>
        );
    } else if (link !== null) {
        body = (
            <NewPasswordForm
                key={link.token}
                onSubmit={async password => {
                    try {
                        await resetPassword(link.userId, link.token, password);
                        setOutcome({ token: link.token, kind: 'changed' });
                        return null;
                    } catch (err) {
                        if (err instanceof InvalidResetLinkError) {
                            setOutcome({ token: link.token, kind: 'refused', message: err.message });
                            return null;
                        }
                        return err instanceof Error ? err.message : 'Could not set your new password. Please try again.';
                    }
                }}
            />
        );
    } else if (fragment === '' || fragment === '#') {
        // No link at all: the page opened by hand, or reloaded or gone back to after it took its link out of
        // the address bar, a successful reset included. Nothing here failed, so it says what the page is for.
        body = (
            <div className="space-y-5">
                <p className="text-fg-soft leading-relaxed">
                    This page sets a new password from the link in a reset email. Open the link from the email,
                    or, if you have just set a new password here, sign in with it.
                </p>
                <div className="flex flex-wrap gap-3">
                    <button type="button" className="btn-primary px-5 py-2.5" onClick={() => authDialog.open('login')}>
                        Sign in
                    </button>
                    <button type="button" className="btn-outline px-5 py-2.5" onClick={() => authDialog.open('forgot-password')}>
                        Ask for a new link
                    </button>
                </div>
            </div>
        );
    } else if (fragment !== null) {
        body = (
            <ErrorState title="This link is not complete" size="section">
                <p>
                    Part of it is missing, which happens when a link is copied by hand or broken across two lines.
                    Open it straight from the email, or ask for a new one.
                </p>
                <div className="mt-4">{askAgain}</div>
            </ErrorState>
        );
    } else {
        body = (
            <LoadingState label="Reading your link…">
                <SkeletonLine width="70%" />
            </LoadingState>
        );
    }

    return (
        <>
            <PageHeader title="Choose a new password" width="4xl" />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="max-w-md">
                    {settled === null ? body : (
                        <div ref={outcomeRef} tabIndex={-1} className="focus:outline-hidden">{body}</div>
                    )}
                </div>
            </div>
        </>
    );
}
