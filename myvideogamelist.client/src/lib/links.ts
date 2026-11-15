/** Addresses outside the site that more than one place links to, each written once. */

/**
 * The community's Discord server (issue 202). An invite that never expires: Discord's default lasts seven
 * days, after which every page would link to a dead invite with nothing to show for it.
 */
export const DISCORD_INVITE_URL = 'https://discord.gg/pPnapgG3WU';

/**
 * The mailbox somebody reads, and where a reply to any of the site's emails goes (ADR 0088). The one way
 * out for somebody whose email never arrives, which `StillNothing` names wherever an email is said to
 * have been sent: an address that once bounced or complained is sent nothing more, and only the owner can
 * lift that (ADR 0091).
 */
export const SUPPORT_EMAIL = 'support@myvideogamelist.net';
