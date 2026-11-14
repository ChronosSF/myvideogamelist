import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessPorts } from './stand-ins';

/**
 * Where a harness's API writes the emails it would have sent (ADR 0088's outbox): a folder per harness,
 * by the API's port, so that the smoke test and the Lighthouse audit never read each other's. Under the
 * system's temp folder, and never emptied: each run's addresses are its own, and an email is found by
 * its recipient.
 */
export const outboxFor = (ports: HarnessPorts) => join(tmpdir(), `mvgl-outbox-${ports.api}`);

/** The `To:` header of an `.eml` file, which is the first one with that name. */
function recipientOf(eml: string): string | undefined {
    return /^To: (.+)$/m.exec(eml)?.[1]?.trim();
}

/**
 * The link to `page` in the latest email the API wrote to `email`, as a reader would copy it: whole, with
 * the account and token after its `#`. The API writes the file before it answers, so it is there by the
 * time anything asks.
 */
function latestLinkTo(outbox: string, email: string, page: string): string {
    const files = readdirSync(outbox).filter(name => name.endsWith('.eml')).sort();
    for (const name of files.reverse()) {
        const eml = readFileSync(join(outbox, name), 'utf8');
        if (recipientOf(eml)?.toLowerCase() !== email.toLowerCase()) continue;

        const link = eml.split(/\s+/).find(word => word.includes(`${page}#`));
        if (link !== undefined) return link;
    }
    throw new Error(`No link to ${page} was sent to ${email} in ${outbox}.`);
}

/** The link in the latest confirmation the API wrote to `email` (ADR 0089). */
export const confirmationLinkFor = (outbox: string, email: string) => latestLinkTo(outbox, email, '/confirm-email');

/** The link in the latest password reset the API wrote to `email` (ADR 0090). */
export const resetLinkFor = (outbox: string, email: string) => latestLinkTo(outbox, email, '/reset-password');

/** The two halves of a confirmation link, decoded, as the page reads them from its fragment. */
export function confirmationIn(link: string): { userId: string; token: string } {
    const params = new URLSearchParams(new URL(link).hash.slice(1));
    const userId = params.get('user');
    const token = params.get('token');
    if (!userId || !token) throw new Error(`Not a confirmation link: ${link}`);
    return { userId, token };
}
