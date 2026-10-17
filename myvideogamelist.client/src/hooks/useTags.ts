import { useContext } from 'react';
import { TagsContext, type TagsContextValue } from '@/contexts/TagsContext';

export function useTags(): TagsContextValue {
    const ctx = useContext(TagsContext);
    if (!ctx) throw new Error('useTags must be used within TagsProvider');
    return ctx;
}
