import { useOutletContext } from 'react-router';
import type { UserProfile } from '@/types/auth';

/** What the profile page hands its two tabs (ADR 0084): the reader, and the two acts the page itself owns. */
export interface UserPageOutlet {
    user: UserProfile;
    /** Signs out, and goes home once the server agrees. */
    signOut: () => void;
    signingOut: boolean;
    /** The server refused the sign-out, or could not be asked: still signed in, and told so. */
    signOutError: string | null;
    /**
     * Deletes the account. The page owns it rather than the Settings tab, because the render in which the
     * account disappears is the page's, and it has to know why nobody is signed in any more.
     */
    deleteAccount: (password: string) => Promise<void>;
}

export function useUserPage(): UserPageOutlet {
    return useOutletContext<UserPageOutlet>();
}
