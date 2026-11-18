import { type ListId, LIST_IDS } from '@/types/list';

/**
 * Which list the lists page has open, kept in its address: `/lists?list=finished`. A reload, a
 * bookmark and the browser's Back then all come back to the list that was open, where page state
 * started every visit on Playing.
 *
 * The value is the list's id, never the name its owner gave it (ADR 0031): a rename must not break
 * an address somebody saved.
 */
export const LIST_PARAM = 'list';

/**
 * The list `/lists` opens with no parameter, so that every link already pointing there still opens
 * what it always did. It is written as no parameter too, never as `?list=playing`, so the default
 * has one address.
 */
export const DEFAULT_LIST: ListId = 'playing';

/** The list an address names. A value that is none of the five is the default, never an error. */
export function listFromAddress(params: URLSearchParams): ListId {
    const named = params.get(LIST_PARAM);
    return LIST_IDS.find(id => id === named) ?? DEFAULT_LIST;
}

/** The same parameters with the open list changed, whatever else the address carries. */
export function withList(params: URLSearchParams, listId: ListId): URLSearchParams {
    const next = new URLSearchParams(params);
    if (listId === DEFAULT_LIST) next.delete(LIST_PARAM);
    else next.set(LIST_PARAM, listId);
    return next;
}
