import userEvent from '@testing-library/user-event';

/**
 * A user-event actor that does not pause between keystrokes.
 *
 * By default user-event waits on a timer after every character it types and every press it makes.
 * Through a page with the app's providers around it, a sentence typed that way costs seconds under a
 * full suite's load, and buys nothing: the events still arrive in the order a person's would. A test
 * about a timer — the browse page's search debounce — fakes that timer itself rather than relying on
 * these pauses.
 */
export function quickActor() {
    return userEvent.setup({ delay: null });
}

export type Actor = ReturnType<typeof quickActor>;
