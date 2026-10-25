import { ReleaseLineHeading } from '@/components/ReleaseLineHeading';
import './ReleaseLine.css';

/**
 * The two-week line as a server render can draw it, for a reader the edge's signed-in flag says is signed
 * in (ADR 0074): the line's heading, and the sentence the line itself shows while it looks the releases
 * up. Not the line's shapes: its days are the reader's own, read from their clock, which no server render
 * knows — drawing them here would be a page that hydrates on a different day than it rendered.
 */
export function ReleaseLineSkeleton() {
    return (
        <section aria-labelledby="release-line-heading">
            <ReleaseLineHeading />
            <div className="release-line-scroll">
                <p className="release-line-note">Looking up what is coming for your games…</p>
            </div>
        </section>
    );
}
