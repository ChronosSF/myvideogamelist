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
 * They do not make the page inert or trap focus — that is the browser's half, checked in one.
 */
if (typeof HTMLDialogElement.prototype.showModal !== 'function') {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
        this.open = true;
    };
}

if (typeof HTMLDialogElement.prototype.close !== 'function') {
    HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
        if (!this.open) return;
        this.open = false;
        this.dispatchEvent(new Event('close'));
    };
}

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
