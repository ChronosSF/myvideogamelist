import { useContext } from 'react';
import { AuthDialogContext, type AuthDialogContextValue } from '@/contexts/AuthDialogContext';

export function useAuthDialog(): AuthDialogContextValue {
    const ctx = useContext(AuthDialogContext);
    if (!ctx) throw new Error('useAuthDialog must be used within AuthDialogProvider');
    return ctx;
}
