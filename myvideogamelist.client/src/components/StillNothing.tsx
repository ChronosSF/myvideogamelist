import { SUPPORT_EMAIL } from '@/lib/links';

/**
 * The way out for somebody whose email never arrives: the support address, as a sentence for the place
 * that shows it to set in its own paragraph.
 *
 * Everywhere that says an email was sent ends with it. SES sends nothing to an address that once bounced
 * or complained, and tells the API nothing about it (ADR 0091), so the API answers as though the email
 * went, and asking again cannot help such a person. Only somebody who can lift the address can.
 */
export function StillNothing() {
    return (
        <>
            Still nothing? Write to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="text-link">{SUPPORT_EMAIL}</a>.
        </>
    );
}
