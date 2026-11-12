import { createContext } from 'react';
import type { Look } from '@/types/look';

export interface LookContextValue {
    /**
     * Draws the page in a look the settings page has not saved yet, or, given null, goes back to the
     * account's. A preview belongs to the account it was shown for and ends with it.
     */
    preview: (look: Look | null) => void;
}

export const LookContext = createContext<LookContextValue | null>(null);
