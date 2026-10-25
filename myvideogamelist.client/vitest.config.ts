import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Separate from `vite.config.ts` on purpose.
 *
 * That config exports the HTTPS dev certificate whenever Vite's command is `serve` — it shells
 * out to `dotnet dev-certs` and writes files — and `serve` is the command Vitest runs under, so
 * what spares a build would not spare a test run. None of it has anything to do with running
 * unit tests, and it would make every test invocation depend on the .NET SDK being present.
 * Vitest prefers this file when both exist, so the two never interfere.
 *
 * The `@/` alias is duplicated rather than shared because it is two lines, and the dev config
 * exports a function of Vite's command rather than an object: reaching the alias would mean
 * calling it with a command invented for the purpose.
 */
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'],
        restoreMocks: true,
        // West of Greenwich, and with no daylight saving to tie a test to its date. A day the API
        // sends as `YYYY-MM-DD`, read as UTC midnight, is the day before here, so a test of one fails
        // as a reader in the Americas would see it fail; in UTC, where CI runs, both readings agree and
        // such a test passes whichever the code does. In `env` rather than the shell, because Vitest
        // assigns it as each worker starts, on every machine alike. That needs a process per worker,
        // as the default forks pool gives: a worker thread keeps the host's zone whatever TZ says, and
        // releaseDate.test.ts fails if that ever happens. What the pin cannot catch is the mirror
        // slip, a parsed day read back through UTC, which is wrong only east of Greenwich.
        env: { TZ: 'Pacific/Honolulu' },
        // Route types live in .react-router and the build output is not test input.
        exclude: ['node_modules', 'build', '.react-router'],
    },
});
