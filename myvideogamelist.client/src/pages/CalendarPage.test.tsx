import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { CalendarPage, headers, meta } from '@/pages/CalendarPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { PRIVATE_NO_STORE } from '@/lib/cache';
import { NOINDEX } from '@/lib/seo';
import { userProfile } from '@/test/factories';

/**
 * Auth, mocked: the real provider fetches, and the page only reads who is signed in. One module-level
 * object handed back on every call, as every hook mock here has to be.
 */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateTheme: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));

// The calendar itself is `ReleaseCalendar`'s tests; here it only has to be there or not.
vi.mock('@/components/ReleaseCalendar', () => ({
    ReleaseCalendar: ({ userId }: { userId: string }) => <p>The calendar of {userId}</p>,
}));

function renderPage() {
    return render(
        <MemoryRouter initialEntries={['/calendar']}>
            <CalendarPage />
        </MemoryRouter>,
    );
}

beforeEach(() => {
    auth.user = null;
    auth.loading = false;
});

describe('CalendarPage', () => {
    it('is never stored between the server and its reader, nor indexed (K6)', () => {
        expect(headers()).toEqual({ 'Cache-Control': PRIVATE_NO_STORE });
        expect(meta()).toContainEqual(NOINDEX);
    });

    it('asks a visitor to sign in, since there is nothing connected to nobody', () => {
        renderPage();

        expect(screen.getByText('Sign in to see what is coming for your games.')).toBeInTheDocument();
        expect(screen.queryByText(/The calendar of/)).not.toBeInTheDocument();
    });

    it('says nothing either way until auth has answered', () => {
        auth.loading = true;
        renderPage();

        expect(screen.getByRole('status')).toHaveTextContent('Loading');
        expect(screen.queryByText('Sign in to see what is coming for your games.')).not.toBeInTheDocument();
    });

    it("draws the signed-in reader's own calendar", () => {
        auth.user = userProfile({ id: 'user-7' });
        renderPage();

        expect(screen.getByText('The calendar of user-7')).toBeInTheDocument();
    });
});
