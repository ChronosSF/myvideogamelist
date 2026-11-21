import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PlaythroughPopup } from '@/components/PlaythroughPopup';
import { game, playthrough } from '@/test/factories';

function renderPopup(saving: boolean, onClose = vi.fn()) {
    render(
        <PlaythroughPopup
            game={game({ id: 1, title: 'Celeste' })}
            kind="start"
            playthrough={playthrough({ id: 7, startedOn: '2026-11-15', finishedOn: null })}
            saving={saving}
            error={null}
            onSubmit={vi.fn()}
            onClose={onClose}
        />,
    );
    return { onClose, dialog: screen.getByRole('dialog', { name: 'Your playthrough' }) as HTMLDialogElement };
}

describe('closing the popup', () => {
    it('opens as a modal dialog on the run it was given', () => {
        const { dialog } = renderPopup(false);

        expect(dialog.open).toBe(true);
        expect(screen.getByLabelText('Started')).toHaveValue('2026-11-15');
    });

    it('asks the provider to close it when Escape is pressed', () => {
        const { dialog, onClose } = renderPopup(false);

        fireEvent(dialog, new Event('cancel', { cancelable: true }));

        expect(onClose).toHaveBeenCalledOnce();
    });

    it('opens itself again if the browser closes it while a save is out, so the answer is seen', () => {
        const { dialog, onClose } = renderPopup(true);

        dialog.close();
        fireEvent(dialog, new Event('close'));

        expect(dialog.open).toBe(true);
        expect(onClose).not.toHaveBeenCalled();
    });

    it('tells the provider when the browser closes it with no save out', () => {
        const { dialog, onClose } = renderPopup(false);

        dialog.close();
        fireEvent(dialog, new Event('close'));

        expect(onClose).toHaveBeenCalled();
    });
});
