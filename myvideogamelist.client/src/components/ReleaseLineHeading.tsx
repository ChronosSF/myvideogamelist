import { HomeSectionHeading } from '@/components/HomeSectionHeading';

/**
 * The two-week line's heading and its way to the calendar: the line's own, and its skeleton's while the
 * line cannot be drawn yet, so the two never say different things. The home page's section heading, with
 * the ruler hanging from its rule. The link is always there, empty line or not (L6): the calendar is where
 * the months after these two weeks are, and what is known only to its month or year.
 */
export function ReleaseLineHeading() {
    return (
        <HomeSectionHeading
            id="release-line-heading"
            title="Coming up"
            subtitle="The next two weeks for your games, with the showcases and sales"
            action={{ to: '/calendar', label: 'The whole calendar' }}
            compact
        />
    );
}
