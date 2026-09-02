import { useId, useState } from 'react';
import { MAX_SCORE, STAR_COUNT, starFill } from '@/lib/score';
import './ScoreInput.css';

interface ScoreInputProps {
    score: number | null;
    onChange: (score: number | null) => void;
    disabled?: boolean;
    /** Names the control for screen readers, since the visible label is the game row itself. */
    gameTitle: string;
    /** `sm` for a table cell, `md` for the game page panel. */
    size?: 'sm' | 'md';
}

/** Every value the control can take: half-star steps over five stars, so 1-10 exactly. */
const STEPS = Array.from({ length: MAX_SCORE }, (_, i) => i + 1);

const STAR_PATH = 'M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z';

function Star({ className }: { className?: string }) {
    return (
        <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d={STAR_PATH} />
        </svg>
    );
}

/**
 * The one control for a score this user gave.
 *
 * Five stars with half-star steps, which is the same ten values the API has always stored — so
 * this is a display change, not a scale change. Stars are reserved for the user's own score;
 * anything averaged from other people is a number out of 100. See `docs/decisions/0021-*`.
 *
 * Under the stars it is a radio group of ten inputs, which buys arrow-key stepping, a real
 * `disabled` that propagates from the fieldset, and a name for each value, none of which a
 * div-and-click-handler implementation gets. The visible number beside the stars is not
 * decoration: a half star is hard to read at a glance, and scoring is a thing people check.
 */
export function ScoreInput({ score, onChange, disabled, gameTitle, size = 'sm' }: ScoreInputProps) {
    const name = useId();

    // Held locally so the stars reflect the choice instantly even while the request is in
    // flight; the provider rolls the whole list back if the save fails.
    const [value, setValue] = useState(score);
    const [lastScore, setLastScore] = useState(score);
    const [hovered, setHovered] = useState<number | null>(null);

    // Adjust during render rather than in an effect — the documented pattern for resetting state
    // when a prop changes, and what the lint rule here requires.
    if (score !== lastScore) {
        setLastScore(score);
        setValue(score);
    }

    const pick = (next: number | null) => {
        setValue(next);
        onChange(next);
    };

    // Hovering previews the score that a click would set, which is the only thing that makes
    // half-star precision discoverable with a pointer.
    const shown = hovered ?? value;

    return (
        <fieldset
            className={`score-stars score-stars-${size}${value === null ? ' empty' : ''}`}
            disabled={disabled}
            aria-label={`Your score for ${gameTitle}`}
        >
            <div className="score-stars-track" onMouseLeave={() => setHovered(null)}>
                <div className="score-stars-glyphs" aria-hidden="true">
                    {Array.from({ length: STAR_COUNT }, (_, index) => (
                        <span className="score-star" key={index}>
                            <Star className="score-star-outline" />
                            <span
                                className="score-star-fill"
                                style={{ width: `${starFill(index, shown) * 100}%` }}
                            >
                                <Star className="score-star-solid" />
                            </span>
                        </span>
                    ))}
                </div>

                {STEPS.map(step => (
                    <label
                        key={step}
                        className="score-stars-zone"
                        style={{ left: `${((step - 1) / MAX_SCORE) * 100}%`, width: `${100 / MAX_SCORE}%` }}
                        onMouseEnter={() => setHovered(step)}
                    >
                        <input
                            type="radio"
                            name={name}
                            value={step}
                            checked={value === step}
                            onChange={() => pick(step)}
                            // Clicking the star you already gave takes the score off again. The
                            // click handler runs before the change event, so `value` here is
                            // still the old one, and an unchecked radio never reaches this branch.
                            onClick={() => { if (value === step) pick(null); }}
                        />
                        <span className="sr-only">{step} out of {MAX_SCORE}</span>
                    </label>
                ))}
            </div>

            <span className="score-stars-readout" aria-hidden="true">
                {shown === null ? '–' : shown}
            </span>

            {value !== null && (
                <button
                    type="button"
                    className="score-stars-clear"
                    onClick={() => pick(null)}
                    aria-label={`Clear your score for ${gameTitle}`}
                    title={`Clear your score for ${gameTitle}`}
                >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </fieldset>
    );
}
