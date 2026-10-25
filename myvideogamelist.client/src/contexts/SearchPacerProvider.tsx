import { useState, type ReactNode } from 'react';
import { createSearchPacer } from '@/hooks/useGameSearch';
import { SearchPacerContext } from './SearchPacerContext';

/**
 * Holds the `SearchPacer` every game search under it shares: the spacing between their requests, and
 * a 503's wait. Around the navbar and the pages both, because the budget is the reader's rather than
 * the field's, and an import review has a search of its own on every row it could not place, under a
 * navbar with one too.
 *
 * Made once per render on the server, where nothing asks, and once per page load in the browser. It
 * holds nothing of the account's: IGDB's catalogue reads the same for everybody.
 */
export function SearchPacerProvider({ children }: { children: ReactNode }) {
    const [pacer] = useState(createSearchPacer);

    return <SearchPacerContext.Provider value={pacer}>{children}</SearchPacerContext.Provider>;
}
