import { FavouritesShowcase } from '@/components/FavouritesShowcase';
import { ProfileHistory } from '@/components/ProfileHistory';
import { ProfileStats } from '@/components/ProfileStats';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { useUserPage } from '@/lib/userPage';

/** The reader's own tracking: nothing shared, as the profile page says for both its tabs. */
export function headers() {
    return { 'Cache-Control': PRIVATE_NO_STORE };
}

/**
 * The profile's Your tracking tab (ADR 0084): what the reader has done, which is the reason they came, at
 * the page's full width now that the settings have a tab of their own. The favourites open it, as they
 * open the public profile: a showcase is the part of a profile chosen to be looked at.
 */
export default function UserTrackingPage() {
    const { user } = useUserPage();

    return (
        <div className="user-page-tracking">
            <div className="user-card">
                <FavouritesShowcase profileVisibility={user.profileVisibility} />
            </div>
            <div className="user-card">
                <ProfileStats userId={user.id} />
            </div>
            {/* Under the figures, as the records behind them: each move, score and run date as it was
                written, where the chart counts them by ADR 0047's rules. Here only — the public profile
                publishes counts, the month series and the reviews its owner chose to publish, and never
                this list. */}
            <div className="user-card">
                <ProfileHistory userId={user.id} />
            </div>
        </div>
    );
}
