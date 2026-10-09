import { useId } from 'react';

/**
 * The MyVideoGameList mark: a play triangle on a navy tile, with the lime "done"
 * badge clipped out of its top-right corner.
 *
 * The mask id has to be unique per instance — two copies on one page (navbar and
 * footer, say) would otherwise share an id and the second would render un-masked.
 *
 * In the brand's colours, which are tokens of their own and the same in every palette. The mask's
 * white and black are not colours anybody sees: white keeps what is under it, black cuts it out.
 */
export function Logo({ className = 'w-7 h-7' }: { className?: string }) {
    const maskId = useId();

    return (
        <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
            <mask id={maskId}>
                <rect width="64" height="64" fill="white" />
                <rect x="37" y="-3" width="30" height="30" rx="11" fill="black" />
            </mask>
            <g mask={`url(#${maskId})`}>
                <rect y="8" width="56" height="56" rx="15" className="fill-brand-navy" />
                <path
                    d="M21 26 40 36 21 46Z"
                    className="fill-brand-light stroke-brand-light"
                    strokeWidth="6"
                    strokeLinejoin="round"
                />
            </g>
            <rect x="40" width="24" height="24" rx="8" className="fill-brand-lime" />
            <path
                d="M45.5 12 49.5 16 58 7"
                fill="none"
                className="stroke-brand-navy"
                strokeWidth="4"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
}
