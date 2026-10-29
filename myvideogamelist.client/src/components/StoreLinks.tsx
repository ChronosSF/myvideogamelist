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
 * keeps it only on that store's own host. They open as every link out of the site does, and never with
 * `nofollow`: this page shows Steam's news, and Steam's terms forbid it on a link to Steam from a page
 * that does (see `SiteFooter`). Renders nothing at all when IGDB names no store, rather than a heading
 * over an empty row.
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
                            rel="noopener noreferrer"
                            // `outline-hidden`, not `outline-none`: in forced colours the ring is dropped
                            // with every other shadow, and only this keeps an outline there to show focus.
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-sm font-medium btn-outline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus"
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
