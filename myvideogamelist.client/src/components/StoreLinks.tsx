import { useId } from 'react';
import { SectionHeading } from '@/components/SectionHeading';
import type { StoreLinkDto } from '@/types/game';

interface StoreLinksProps {
    /** One per store, in the order the API gives them. */
    stores: StoreLinkDto[];
}

/**
 * The game page's "Where to play" row (issue 130): a link to each store IGDB says the game is sold on.
 *
 * Links and nothing more. No price, because prices are IsThereAnyDeal's to give (ADR 0009), and no
 * parameter in the address that would pay anybody for the click — the API cuts each one at its path and
 * keeps it only on that store's own host. `nofollow` because the page vouches for none of the stores.
 * Renders nothing at all when IGDB names none, rather than a heading over an empty row.
 */
export function StoreLinks({ stores }: StoreLinksProps) {
    // Stable between the server render and hydration, which a counter or a random id would not be.
    const headingId = useId();

    if (stores.length === 0) return null;

    return (
        <section>
            <SectionHeading id={headingId}>Where to play</SectionHeading>
            <ul aria-labelledby={headingId} className="flex flex-wrap gap-2">
                {stores.map(link => (
                    <li key={link.store}>
                        <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-raised/60 text-primary-400 hover:text-primary-300 text-xs font-medium rounded-lg border border-line hover:border-line-strong transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                        >
                            {link.store} <span className="sr-only">(opens in a new tab)</span>
                            <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </li>
                ))}
            </ul>
        </section>
    );
}
