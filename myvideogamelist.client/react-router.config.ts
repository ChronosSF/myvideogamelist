import type { Config } from '@react-router/dev/config';

export default {
    // Keep the existing src/ layout rather than moving everything to app/,
    // so the "@/" alias and all existing imports stay valid.
    appDirectory: 'src',

    // Server-side rendering. Game pages and public profiles are the organic
    // acquisition channel, and crawlers previously saw an empty <div id="root">.
    ssr: true,

    // The five v8_* future flags this config used to carry are all default
    // behaviour in v8, so the `future` block is gone. `splitRouteModules` moved
    // to a top-level field and defaults to true; set it to "enforce" if every
    // route should be required to split.
} satisfies Config;
