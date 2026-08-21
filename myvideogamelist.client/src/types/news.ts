import type { GameDto } from '@/types/game';

export interface NewsItemDto {
    id: string;
    gameId: number;
    gameTitle: string;
    gameCoverUrl: string | null;
    title: string;
    url: string;
    source: string;
    /** Plain text — sanitized server-side. Never render this as HTML. */
    excerpt: string | null;
    publishedAt: string;
}

export interface HomeResponse {
    spotlight: GameDto | null;
    popular: GameDto[];
    news: NewsItemDto[];
}
