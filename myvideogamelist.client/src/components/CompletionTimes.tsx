import type { TimeToBeatDto } from '@/types/game';
import { formatPlaytime } from '@/lib/duration';

interface CompletionTimesProps {
    timeToBeat: TimeToBeatDto;
}

/**
 * The three tiers IGDB reports, in increasing order of effort. The bar fills are a sequential
 * ramp — one hue, light to dark as the commitment grows — rather than three categorical hues,
 * because these are three points on one scale and not three unrelated things.
 */
const TIERS = [
    {
        key: 'hastily',
        label: 'Rushed',
        hint: 'Straight through the main story',
        fill: 'bg-blue-400 light:bg-blue-300',
    },
    {
        key: 'normally',
        label: 'Normally',
        hint: 'Main story plus a helping of extras',
        fill: 'bg-blue-500 light:bg-blue-500',
    },
    {
        key: 'completely',
        label: 'Completionist',
        hint: 'Everything the game has to offer',
        fill: 'bg-blue-600 light:bg-blue-700',
    },
] as const;

/**
 * Average time to finish a game, from community submissions to IGDB.
 *
 * The submission count is always on screen. These averages frequently rest on single-digit
 * samples, and a bare "174h" reads as a measured fact rather than the rough guide it is.
 *
 * Each value gets a thin bar scaled against the longest tier. The numbers alone do not convey
 * that completionist play is often triple the main story; the widths do it at a glance.
 */
export function CompletionTimes({ timeToBeat }: CompletionTimesProps) {
    const longest = Math.max(
        timeToBeat.hastily ?? 0,
        timeToBeat.normally ?? 0,
        timeToBeat.completely ?? 0,
    );

    const tiers = TIERS
        .map(tier => ({ ...tier, seconds: timeToBeat[tier.key], value: formatPlaytime(timeToBeat[tier.key]) }))
        .filter(tier => tier.value !== null);

    if (tiers.length === 0) return null;

    return (
        <div>
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {tiers.map(tier => (
                    <div
                        key={tier.key}
                        className="bg-slate-800/60 light:bg-white border border-slate-700/50 light:border-slate-200 rounded-xl px-4 py-3"
                    >
                        <dt className="text-xs text-slate-500 light:text-slate-400 uppercase tracking-wider">
                            {tier.label}
                        </dt>
                        <dd className="mt-1 text-2xl font-semibold text-white light:text-slate-900 leading-none">
                            {tier.value}
                        </dd>

                        {/* Decorative: the figure above already states the value. */}
                        <div
                            className="mt-2.5 h-1 rounded-full bg-slate-700/60 light:bg-slate-200 overflow-hidden"
                            aria-hidden="true"
                        >
                            <div
                                className={`h-full rounded-full ${tier.fill}`}
                                style={{ width: `${longest > 0 ? ((tier.seconds ?? 0) / longest) * 100 : 0}%` }}
                            />
                        </div>

                        <p className="mt-2 text-xs text-slate-500 light:text-slate-400 leading-snug">{tier.hint}</p>
                    </div>
                ))}
            </dl>

            <p className="mt-3 text-xs text-slate-500 light:text-slate-400">
                Averaged from {timeToBeat.count.toLocaleString()} community{' '}
                {timeToBeat.count === 1 ? 'submission' : 'submissions'}.
            </p>
        </div>
    );
}
