/**
 * What the Turnstile stand-in in `@/test/turnstile` does, which a test sets: whether each mount hands
 * over its token as it mounts, and how many have mounted, which numbers their tokens.
 */
export const turnstileStub = {
    autoPass: true,
    mounts: 0,
    reset() {
        this.autoPass = true;
        this.mounts = 0;
    },
};
