import type { Config } from '@react-router/dev/config';

export default {
    // Keep the existing src/ layout rather than moving everything to app/,
    // so the "@/" alias and all existing imports stay valid.
    appDirectory: 'src',

    // Server-side rendering. Game pages and public profiles are the organic
    // acquisition channel, and crawlers previously saw an empty <div id="root">.
    ssr: true,
} satisfies Config;
