import { type ReactNode, useEffect, useEffectEvent, useState, useSyncExternalStore } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { SkeletonLine } from '@/components/SkeletonLine';
import { useAuth } from '@/hooks/useAuth';
import { useAuthDialog } from '@/hooks/useAuthDialog';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { linkIn } from '@/lib/confirmationLink';
import { NOINDEX } from '@/lib/seo';

/** One person's link, so never cacheable. Declared rather than inherited from the root. */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

export function meta() {
    return [
        { title: 'Confirm your email address - MyVideoGameList' },
        { name: 'description', content: 'Confirm the email address of your MyVideoGameList account.' },
        NOINDEX,
    ];
}

/** Never fires: the fragment is read once, and this page removes it itself. */
const noopSubscribe = () => () => {};

/**
 * The fragment as the browser has it, and null during the server render and hydration, which never
 * see it: a browser does not send what follows the `#`.
 */
function useFragment(): string | null {
    return useSyncExternalStore(noopSubscribe, () => window.location.hash, () => null);
}

type Outcome = { kind: 'confirmed' } | { kind: 'failed'; message: string };

/**
 * Where the link in a confirmation email leads (ADR 0089).
 *
 * The account and its token are in the fragment, never the query, so that neither this server's request
 * log, nor a cache, nor a `Referer` ever holds them. This page reads them once it is running in the
 * browser and posts them to the API, which a link cannot do by itself: a `GET` would be forgeable, and a
 * mail scanner opening the link would confirm the address on its owner's behalf. Then it takes them out
 * of the address bar, so that they are not left in the history.
 *
 * Confirming signs nobody in. The link stays good for its whole day, so whoever holds it should not hold
 * the account too: signing in still takes the password.
 */
export default function ConfirmEmailPage() {
    const { confirmEmail } = useAuth();
    const authDialog = useAuthDialog();
    const fragment = useFragment();
    const link = fragment === null ? null : linkIn(fragment);
    const [outcome, setOutcome] = useState<Outcome | null>(null);

    // Keyed on the two values, not the object, which is a new one each render.
    const userId = link?.userId;
    const token = link?.token;

    // The provider makes its functions anew on every render, so the effect reads the latest one
    // rather than re-running, and posting again, every time the provider draws.
    const confirm = useEffectEvent((id: string, value: string) => confirmEmail(id, value));

    useEffect(() => {
        if (userId === undefined || token === undefined) return;

        // Strict Mode runs this twice in development. Confirming twice is harmless; only the answer
        // that is still wanted is kept.
        let wanted = true;
        confirm(userId, token)
            .then(() => {
                if (wanted) setOutcome({ kind: 'confirmed' });
            })
            .catch((err: unknown) => {
                if (!wanted) return;
                setOutcome({
                    kind: 'failed',
                    message: err instanceof Error ? err.message : 'Could not confirm your address. Please try again.',
                });
            })
            .finally(() => {
                // Out of the address bar and the history, worked or not: the token has been used or
                // is no good, and either way nothing should keep it.
                if (wanted) window.history.replaceState(window.history.state, '', window.location.pathname);
            });

        return () => {
            wanted = false;
        };
    }, [userId, token]);

    const signIn = (
        <button type="button" className="btn-primary px-5 py-2.5" onClick={() => authDialog.open('login')}>
            Sign in
        </button>
    );

    let body: ReactNode;
    if (outcome?.kind === 'confirmed') {
        body = (
            <div className="space-y-5">
                <p className="text-fg-soft leading-relaxed">
                    Your email address is confirmed, and your account is ready. Sign in to start tracking.
                </p>
                {signIn}
            </div>
        );
    } else if (outcome?.kind === 'failed') {
        body = (
            <ErrorState title="That link did not work" size="section">
                <p>{outcome.message}</p>
                <div className="mt-4">{signIn}</div>
            </ErrorState>
        );
    } else if (fragment !== null && link === null) {
        body = (
            <ErrorState title="This link is not complete" size="section">
                <p>
                    Part of it is missing, which happens when a link is copied by hand or broken across two
                    lines. Open it straight from the email, or sign in and we will offer to send a new one.
                </p>
                <div className="mt-4">{signIn}</div>
            </ErrorState>
        );
    } else {
        body = (
            <LoadingState label="Confirming your email address…">
                <SkeletonLine width="70%" />
            </LoadingState>
        );
    }

    return (
        <>
            <PageHeader title="Confirm your email address" width="4xl" />
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
                <div className="max-w-2xl">{body}</div>
            </div>
        </>
    );
}
