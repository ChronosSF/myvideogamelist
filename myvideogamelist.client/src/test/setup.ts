import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
    cleanup();
});

/**
 * jsdom does not implement these, and components under test use them:
 * `scrollIntoView` on navigation, and `matchMedia` via anything reading the theme.
 * Stubbed here rather than in each test so a component gaining one does not break a suite.
 */
Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
});

/**
 * jsdom reflects a dialog's `open` attribute but implements neither `showModal` nor `close`. These
 * stand-ins open and close it and fire `close`, so a component that opens a modal renders under test.
 *
 * They also model the part of a modal a component can get wrong from JavaScript: while one is open,
 * the rest of the document is inert, and `focus()` on anything outside it does nothing. Without that,
 * a component that hands focus back before its modal has gone passes here and fails in a browser —
 * which `AccountDataCard` did once. They do not trap Tab or stop clicks, the browser's half.
 */
const openModals = new Set<HTMLDialogElement>();

if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.open = true;
        openModals.add(this);
    };
}

if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        openModals.delete(this);
        this.dispatchEvent(new Event('close'));
    };
}

const focus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function focusUnlessInert(this: HTMLElement, options?: FocusOptions) {
    for (const modal of openModals) {
        // A modal taken out of the document, as unmounting does, has left the top layer with it.
        if (!modal.isConnected || !modal.open) {
            openModals.delete(modal);
        } else if (!modal.contains(this)) {
            return;
        }
    }
    focus.call(this, options);
};

Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    }),
});
