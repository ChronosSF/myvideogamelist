import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { applyLook, storeLook } from '@/lib/look';
import { DEFAULT_LOOK, type Look } from '@/types/look';
import { LookContext } from './LookContext';

/**
 * Keeps the page in its reader's look (ADR 0082): the account's once auth has answered, the default for
 * nobody, and the settings page's unsaved one while it shows one.
 *
 * Until auth answers it leaves the page alone, in whatever the head script drew from the browser's copy,
 * which is the account's as of the last page: drawing the default meanwhile would be the flash the copy is
 * there to prevent. Once it has answered it keeps that copy current, and removes it for nobody, so a
 * shared computer signed out does not keep the last reader's colours.
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
        if (loading) return;
        applyLook(previewed ?? account ?? DEFAULT_LOOK);
    }, [loading, previewed, account]);

    useEffect(() => {
        if (loading) return;
        storeLook(account);
    }, [loading, account]);

    const show = useCallback(
        (look: Look | null) => setPreview(look !== null && accountId !== null ? { accountId, look } : null),
        [accountId],
    );
    const value = useMemo(() => ({ preview: show }), [show]);

    return <LookContext.Provider value={value}>{children}</LookContext.Provider>;
}
