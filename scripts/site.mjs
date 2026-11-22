/*
 * site.mjs — what an environment is called and where it answers, for the two scripts that ask it
 * anything, dev-env.mjs and dev-check.mjs. It restates infra/src/Infra/Site.cs, which is where each of
 * these is decided: change one there and change it here.
 */

const DOMAIN = 'myvideogamelist.net';

/** Production's `env`: the one environment that answers at the domain itself (Site.Production). */
const PRODUCTION = 'prod';

/**
 * - `production`: whether this is production (Site.IsProduction).
 * - `host`: the one name the site answers by (Site.Host).
 * - `redirectedHosts`: the names that only redirect to it, production's www (Site.RedirectedHosts).
 * - `indexable`: whether a crawler may index it, production's alone (Site.Indexable).
 * - `basicAuthVariable`: the shell variable that holds the basic-auth pair as `user:password`, when
 *   whoever runs the script has it. Never in the repository, and never printed.
 */
export function site(env) {
    const production = env === PRODUCTION;
    return {
        production,
        host: production ? DOMAIN : `${env}.${DOMAIN}`,
        redirectedHosts: production ? [`www.${DOMAIN}`] : [],
        indexable: production,
        basicAuthVariable: `MVGL_${env.toUpperCase()}_BASIC_AUTH`,
    };
}
