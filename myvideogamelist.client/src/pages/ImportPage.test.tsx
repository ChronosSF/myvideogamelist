import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ImportPage } from '@/pages/ImportPage';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type { UseAccountResourceResult } from '@/hooks/useAccountResource';
import type { UseImportUploadResult } from '@/hooks/useImport';
import { importJob, userProfile } from '@/test/factories';
import { IMPORT_STATE, type ImportJob } from '@/types/import';

/** Auth and both import hooks, mocked, one object each so no render hands back a fresh one. */
const auth: AuthContextValue = {
    user: null,
    loading: false,
    login: vi.fn(async () => {}),
    register: vi.fn(async () => ({ emailSent: true })),
    resendConfirmation: vi.fn(async () => {}),
    confirmEmail: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    updateUserName: vi.fn(async () => {}),
    updateProfileVisibility: vi.fn(async () => {}),
    updateProfileDetails: vi.fn(async () => {}),
    updateLook: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
};

const jobs: UseAccountResourceResult<ImportJob[]> = {
    data: [],
    loading: false,
    error: null,
    errorIsPermanent: false,
    reload: vi.fn(),
    patch: vi.fn(),
};

const upload: UseImportUploadResult = { uploading: false, error: null, upload: vi.fn(async () => null) };

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('@/hooks/useImport', () => ({ useImportJobs: () => jobs, useImportUpload: () => upload }));

function renderPage() {
    return render(<MemoryRouter><ImportPage /></MemoryRouter>);
}

beforeEach(() => {
    auth.user = userProfile();
    jobs.data = [];
});

describe('ImportPage', () => {
    it("counts a job waiting for review in its file's rows", () => {
        // Issue 300. A job not yet reviewed knows the games of only the rows it could match, and two
        // rows can name one game, so what it can honestly count is rows — and "1 games" was neither.
        jobs.data = [
            importJob({ id: 'one', fileName: 'one.json', rowCount: 1 }),
            importJob({ id: 'many', fileName: 'many.json', rowCount: 1200 }),
        ];
        renderPage();

        expect(screen.getByRole('link', { name: /one\.json/ })).toHaveTextContent('1 row — review');
        expect(screen.getByRole('link', { name: /many\.json/ })).toHaveTextContent('1,200 rows — review');
    });

    it('names the rows a receipt counts, and claims nothing about where the games went', () => {
        // The job's counts are rows, so that with the skipped ones they add up to the file. The line
        // over them said "The games are in your lists", which a game imported into no list was not.
        jobs.data = [importJob({
            state: IMPORT_STATE.done, rowCount: 17, importedCount: 14, skippedCount: 3,
            completedAt: '2026-09-22T12:30:00Z',
        })];
        renderPage();

        expect(screen.getByText('14 rows imported, 3 skipped')).toBeInTheDocument();
        expect(screen.queryByText(/in your lists/)).not.toBeInTheDocument();
    });
});
