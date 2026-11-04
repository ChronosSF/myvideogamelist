import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { AccountDataCard } from '@/components/AccountDataCard';
import { AccountIdentityCard } from '@/components/AccountIdentityCard';
import { ListNamesCard } from '@/components/ListNamesCard';
import { LookCard } from '@/components/LookCard';
import { ProfileDetailsCard } from '@/components/ProfileDetailsCard';
import { TagsCard } from '@/components/TagsCard';
import { NOINDEX } from '@/lib/seo';
import { useUserPage } from '@/lib/userPage';

export function meta() {
    return [
        { title: 'Settings - MyVideoGameList' },
        { name: 'description', content: 'The settings for your account.' },
        NOINDEX,
    ];
}

/** The page's sections, in the order they are read, which the index beside them lists. */
const SECTIONS = [
    { id: 'account', title: 'Account' },
    { id: 'profile-page', title: 'Your profile page' },
    { id: 'look', title: 'Look' },
    { id: 'lists-and-tags', title: 'Lists and tags' },
    { id: 'your-data', title: 'Import and your data' },
] as const;

type SectionId = typeof SECTIONS[number]['id'];

function SettingsSection({ id, children }: { id: SectionId; children: ReactNode }) {
    const title = SECTIONS.find(section => section.id === id)!.title;
    return (
        <section id={id} aria-labelledby={`${id}-title`} className="user-settings-section">
            <h2 id={`${id}-title`} className="type-display text-3xl text-fg-strong mb-6">{title}</h2>
            {children}
        </section>
    );
}

/**
 * The profile's Settings tab (ADR 0084): every setting, as one page of sections under heavy rules with an
 * index held beside them, as the calendar's month is (ADR 0075). They were a column a fifth of the page
 * wide, three times as tall as the tracking beside it; here a form is as wide as it needs, and two short
 * ones share a row.
 */
export default function UserSettingsPage() {
    const { user, signOut, signingOut, signOutError, deleteAccount } = useUserPage();

    return (
        <div className="user-settings">
            <nav aria-label="Settings" className="user-settings-index">
                <ul>
                    {SECTIONS.map(section => (
                        <li key={section.id}>
                            <a href={`#${section.id}`}>{section.title}</a>
                        </li>
                    ))}
                </ul>
            </nav>

            <div className="user-settings-sections">
                <SettingsSection id="account">
                    <div className="user-settings-pair">
                        {/* The email is here and nowhere else — it identifies the account to us and appears
                            on nothing anybody else can read. */}
                        <div className="user-card">
                            <div className="user-card-label">Email</div>
                            <div className="user-card-value">{user.email}</div>
                            <p className="user-card-hint">Only you can see this.</p>
                        </div>

                        {/* Beside it, because the two answer the same question from opposite sides: what we
                            know you by, and what everybody else does — and whether anybody reads it. */}
                        <AccountIdentityCard user={user} />
                    </div>

                    {/* aria-disabled rather than disabled while the request is out, so the button keeps its
                        focus; the press guards itself. */}
                    <div className="user-settings-signout">
                        <button type="button" className="user-logout-btn" onClick={signOut} aria-disabled={signingOut}>
                            {signingOut ? 'Signing out…' : 'Sign Out'}
                        </button>
                        {signOutError !== null && (
                            <p className="mt-2 text-sm text-danger-300" role="alert">{signOutError}</p>
                        )}
                    </div>
                </SettingsSection>

                {/* What the public page says at its top, under the switch above that decides whether anybody
                    reads it. Keyed by the account, so drafts typed for one are never shown, or saved, under
                    another. */}
                <SettingsSection id="profile-page">
                    <div className="user-settings-narrow">
                        <ProfileDetailsCard key={user.id} user={user} />
                    </div>
                </SettingsSection>

                {/* How the whole site looks to this person and to nobody else; the page around it is its
                    preview. */}
                <SettingsSection id="look">
                    <LookCard key={user.id} look={user.look} canChoose={user.canChooseLook} />
                </SettingsSection>

                {/* Both are words the owner chose that only the owner sees. */}
                <SettingsSection id="lists-and-tags">
                    <div className="user-settings-pair">
                        <ListNamesCard />
                        <TagsCard />
                    </div>
                </SettingsSection>

                {/* The import beside the export, but in a part of its own: an import is reviewed before it
                    writes, and belongs nowhere near the warning that goes with deleting everything. */}
                <SettingsSection id="your-data">
                    <div className="user-settings-pair">
                        <div className="user-card">
                            <div className="user-card-label">Import from another tracker</div>
                            <p className="user-card-hint">
                                Bring your games across from Grouvee. You see every game, and what we
                                made of it, before anything is saved.
                            </p>
                            <Link to="/import" className="user-btn user-card-action">Start an import</Link>
                        </div>

                        <AccountDataCard userName={user.userName} onDeleteAccount={deleteAccount} />
                    </div>
                </SettingsSection>
            </div>
        </div>
    );
}
