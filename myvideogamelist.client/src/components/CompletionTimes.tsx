import type { TimeToBeatDto } from '@/types/game';
import type { PlaythroughTypeKey } from '@/types/playthrough';
import { PLAYTHROUGH_TIERS } from '@/types/playthrough';
import { formatMinutesPlayed, formatPlaytime } from '@/lib/duration';
import { MIN_PLAYTHROUGH_SAMPLES } from '@/lib/score';
import { useCommunityTimes } from '@/hooks/useCommunityTimes';
import { SectionHeading } from '@/components/SectionHeading';

interface CompletionTimesProps {
    /** Null when IGDB reports no completion times for this game, which is common. */
    timeToBeat: TimeToBeatDto | null;
    gameId: number;
}

/** One tier's cell, in whichever of the two rows it belongs to. */
interface Cell {
    key: PlaythroughTypeKey;
    label: string;
    /** The formatted figure, or null when there is none to show. */
    value: string | null;
    /** For scaling the bar against the longest figure in the same row. */
    magnitude: number;
    caption: string;
    fill: string;
}

/**
 * How long a game takes, from IGDB's community and from ours, as two rows over the same three
 * tiers.
 *
 * The tiers are deliberately the same three buckets on both sides — that is what makes the
 * comparison readable rather than a blend of unclear provenance — so the columns always line up
 * and a tier with nothing behind it shows an em dash rather than being dropped from one row and
 * not the other.
 *
 * **Every figure carries its sample size**, on the same argument `docs/decisions/0016-*` makes
 * about scores. IGDB's averages frequently rest on single digits, and ours will rest on fewer for
 * a long while; a bare "174h" reads as a measured fact either way. Ours additionally goes behind
 * a floor: under `MIN_PLAYTHROUGH_SAMPLES` the cell says how many there are and why there is no
 * number, and never shows one.
 *
 * The community figures are fetched on the client, after hydration — see `useCommunityTimes` for
 * why they must not go in the route loader.
 */
export function CompletionTimes({ timeToBeat, gameId }: CompletionTimesProps) {
    const community = useCommunityTimes(gameId);

    const igdbCells: Cell[] = PLAYTHROUGH_TIERS.map(tier => {
        const seconds = timeToBeat?.[tier.igdbKey] ?? null;
        return {
            key: tier.key,
            label: tier.label,
            value: formatPlaytime(seconds),
            magnitude: seconds ?? 0,
            caption: tier.hint,
            fill: tier.fill,
        };
    });

    const communityCells: Cell[] = PLAYTHROUGH_TIERS.map(tier => {
        const bucket = community?.buckets.find(b => b.type === tier.key);
        const samples = bucket?.samples ?? 0;
        const enough = samples >= MIN_PLAYTHROUGH_SAMPLES;

        return {
            key: tier.key,
            label: tier.label,
            value: enough ? formatMinutesPlayed(bucket?.medianMinutes ?? null) : null,
            magnitude: enough ? (bucket?.medianMinutes ?? 0) : 0,
            caption: captionFor(samples, enough),
            fill: tier.fill,
        };
    });

    const hasIgdb = igdbCells.some(cell => cell.value !== null);

    // The row appears only once something in it clears the floor. A row of three dashes saying
    // "too few" three times is noise rather than information — and this is the case that lets the
    // section render for a game IGDB reports no times for at all.
    const hasCommunity = communityCells.some(cell => cell.value !== null);

    if (!hasIgdb && !hasCommunity) return null;

    return (
        <section aria-labelledby="completion-times-heading">
            <SectionHeading id="completion-times-heading">How long to beat</SectionHeading>

            <div className="flex flex-col gap-6">
                {hasIgdb && timeToBeat !== null && (
                    <TierRow
                        title="IGDB community"
                        cells={igdbCells}
                        footnote={`Averaged from ${timeToBeat.count.toLocaleString()} community ${
                            timeToBeat.count === 1 ? 'submission' : 'submissions'
                        }.`}
                    />
                )}

                {hasCommunity && (
                    <TierRow
                        title="MyVideoGameList members"
                        cells={communityCells}
                        footnote={`The middle figure members logged, not the average — one person who left the game running overnight should not move it. Tiers with fewer than ${MIN_PLAYTHROUGH_SAMPLES} playthroughs are not shown.`}
                    />
                )}
            </div>
        </section>
    );
}

/** What a community cell says instead of a number, or alongside one. */
function captionFor(samples: number, enough: boolean): string {
    if (samples === 0) return 'Nobody has logged one yet';
    if (!enough) {
        return `Only ${samples} ${samples === 1 ? 'playthrough' : 'playthroughs'} so far — too few to average`;
    }
    return `From ${samples} playthroughs`;
}

interface TierRowProps {
    title: string;
    cells: Cell[];
    footnote: string;
}

/**
 * One source's three tiers.
 *
 * Each value gets a thin bar scaled against the longest tier *in its own row*, because the two
 * sources measure different populations and a shared scale would imply they are directly
 * comparable in size as well as in shape. The numbers alone do not convey that completionist play
 * is often triple the main story; the widths do it at a glance.
 */
function TierRow({ title, cells, footnote }: TierRowProps) {
    const longest = Math.max(0, ...cells.map(cell => cell.magnitude));

    return (
        <div>
            <h3 className="text-xs font-medium text-slate-400 light:text-slate-500 mb-2">{title}</h3>

            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {cells.map(cell => (
                    <div
                        key={cell.key}
                        className="bg-slate-800/60 light:bg-white border border-slate-700/50 light:border-slate-200 rounded-xl px-4 py-3"
                    >
                        <dt className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider">
                            {cell.label}
                        </dt>
                        <dd className="mt-1 text-2xl font-semibold text-white light:text-slate-900 leading-none">
                            {cell.value ?? '—'}
                        </dd>

                        {/* Decorative: the figure above already states the value. */}
                        <div
                            className="mt-2.5 h-1 rounded-full bg-slate-700/60 light:bg-slate-200 overflow-hidden"
                            aria-hidden="true"
                        >
                            <div
                                className={`h-full rounded-full ${cell.fill}`}
                                style={{ width: `${longest > 0 ? (cell.magnitude / longest) * 100 : 0}%` }}
                            />
                        </div>

                        <p className="mt-2 text-xs text-slate-500 light:text-slate-400 leading-snug">
                            {cell.caption}
                        </p>
                    </div>
                ))}
            </dl>

            <p className="mt-3 text-xs text-slate-500 light:text-slate-400">{footnote}</p>
        </div>
    );
}
