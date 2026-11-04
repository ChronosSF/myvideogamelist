import { NavLink } from 'react-router';

export interface PageTab {
    to: string;
    label: string;
    /** Active only on its own address, not under it: the first tab, whose address the others extend. */
    end?: boolean;
}

interface PageTabsProps {
    /** Names the navigation for a screen reader: what the tabs are of. */
    label: string;
    tabs: PageTab[];
}

/**
 * A page's tabs, each an address of its own (ADR 0084): the game page's Overview and Your game, and the
 * profile's Your tracking and Settings. Links rather than an ARIA tab set, because each is a page a link
 * can name and the back button can return to. Moving between them keeps the reader's place, since what is
 * above them stays the same.
 */
export function PageTabs({ label, tabs }: PageTabsProps) {
    return (
        <nav aria-label={label} className="border-b border-line">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-13 flex gap-9 overflow-x-auto">
                {tabs.map(tab => (
                    <NavLink
                        key={tab.to}
                        to={tab.to}
                        end={tab.end}
                        preventScrollReset
                        className={({ isActive }) => `inline-flex shrink-0 items-center h-full border-b-[3px] text-[0.9375rem] transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus ${
                            isActive
                                ? 'border-primary-500 text-fg-strong font-bold'
                                : 'border-transparent text-fg-muted font-semibold hover:text-fg-strong'
                        }`}
                    >
                        {tab.label}
                    </NavLink>
                ))}
            </div>
        </nav>
    );
}
