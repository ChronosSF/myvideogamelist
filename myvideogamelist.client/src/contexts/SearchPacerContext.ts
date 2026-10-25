import { createContext } from 'react';
import type { SearchPacer } from '@/hooks/useGameSearch';

/**
 * The one budget every game search spends, so that the navbar's typeahead and an import review's row
 * searches keep to it between them. Null outside `SearchPacerProvider`, where a search keeps its own.
 */
export const SearchPacerContext = createContext<SearchPacer | null>(null);
