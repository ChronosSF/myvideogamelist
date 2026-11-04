import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { applyLook, storeLook } from '@/lib/look';
import type { Look } from '@/types/look';
import { LookContext } from './LookContext';

/**
 * Keeps the page in its reader's look (ADR 0082): the account's once auth has answered, and the settings
 * page's unsaved one while it shows one. The account's is what the server answers with, so an account that
 * may not choose one is drawn in the default, and so is its copy.
 *
 * For nobody, and until auth answers, it leaves the page alone, in whatever the head script drew from the
 * browser's copy: drawing the default meanwhile would be the flash the copy is there to prevent. Signing
 * out keeps the copy, so the browser stays in its last reader's look until somebody signs in; a visitor who
 * never has is drawn in the default, since there is no copy. Only deleting the account forgets it
 * (`forgetLook`, called by the auth provider).
 */
export function LookProvider({ children }: { children: ReactNode }) {
    const { user, loading } = useAuth();
    const [preview, setPreview] = useState<{ accountId: string; look: Look } | null>(null);

    const accountId = user?.id ?? null;
    const account = user?.look ?? null;
    // Stamped with the account it was shown for, and compared here rather than cleared on a change of
    // account, so that one account's unsaved look can never be drawn under another's (ADR 0022).
    const previewed = preview !== null && preview.accountId === accountId ? preview.look : null;

    useEffect(() => {
        if (loading || account === null) return;
        applyLook(previewed ?? account);
    }, [loading, previewed, account]);

    useEffect(() => {
        if (loading || account === null) return;
        storeLook(account);
    }, [loading, account]);

    const show = useCallback(
        (look: Look | null) => setPreview(look !== null && accountId !== null ? { accountId, look } : null),
        [accountId],
    );
    const value = useMemo(() => ({ preview: show }), [show]);

    return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}
