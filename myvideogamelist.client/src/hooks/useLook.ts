import { useContext } from 'react';
import { LookContext, type LookContextValue } from '@/contexts/LookContext';

export function useLook(): LookContextValue {
    const ctx = useContext(LookContext);
    if (!ctx) throw new Error('useLook must be used within LookProvider');
    return ctx;
}
