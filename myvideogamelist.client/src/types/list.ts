import type { GameDto } from '@/types/game';

export type ListId = 'playing' | 'backlog' | 'finished';

export interface GameList {
    id: ListId;
    name: string;
    games: GameDto[];
}

export const LIST_IDS: ListId[] = ['playing', 'backlog', 'finished'];

export const LIST_NAMES: Record<ListId, string> = {
    playing: 'Playing',
    backlog: 'Backlog',
    finished: 'Finished',
};
