import { useState } from 'react';

interface ScoreInputProps {
    score: number | null;
    onChange: (score: number | null) => void;
    disabled?: boolean;
    /** Names the control for screen readers, since the visible label is the game row itself. */
    gameTitle: string;
}

const SCORES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * A compact 1–10 score picker, sized to sit in a table cell.
 *
 * A native `<select>` rather than ten stars or a slider: it is one tap on mobile, keyboard
 * operable for free, and scoring a long list is a task people do in bulk — anything requiring
 * aim would make that worse.
 */
export function ScoreInput({ score, onChange, disabled, gameTitle }: ScoreInputProps) {
    // Held locally so the select reflects the choice instantly even while the request is in
    // flight; the provider rolls the whole list back if the save fails.
    const [value, setValue] = useState(score);
    const [lastScore, setLastScore] = useState(score);

    // Adjust during render rather than in an effect — the documented pattern for resetting state
    // when a prop changes, and what the lint rule here requires.
    if (score !== lastScore) {
        setLastScore(score);
        setValue(score);
    }

    return (
        <select
            className={`score-input${value === null ? ' empty' : ''}`}
            value={value ?? ''}
            disabled={disabled}
            aria-label={`Your score for ${gameTitle}`}
            onChange={event => {
                const next = event.target.value === '' ? null : Number(event.target.value);
                setValue(next);
                onChange(next);
            }}
        >
            <option value="">–</option>
            {SCORES.map(n => (
                <option key={n} value={n}>{n}</option>
            ))}
        </select>
    );
}
