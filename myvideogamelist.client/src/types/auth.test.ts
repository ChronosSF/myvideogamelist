import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, userNameProblem } from '@/types/auth';

/**
 * The server's `UserNamePolicy`, read from its source.
 *
 * The sign-up dialog and the account page check a name before a round trip with a copy of the
 * policy's shape rules, and a copy is a second statement of the alphabet — the thing CLAUDE.md says
 * never to write twice. Where it cannot be avoided, it can at least be held to the first: a copy that
 * drifts refuses on this side names the API would take, which nobody can get past, or lets through
 * names the API refuses, which costs a round trip and says the form was wrong.
 *
 * The path is resolved from this file's own, as a string: jsdom replaces the global `URL`, and Node's
 * `fileURLToPath` refuses one of jsdom's.
 */
const POLICY = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), '../../../MyVideoGameList.Server/Models/UserNamePolicy.cs'),
    'utf8',
);

/** A `const` the policy declares, as written: a number's digits, or a string's contents. */
function declared(name: string): string {
    const match = new RegExp(`const\\s+\\w+\\s+${name}\\s*=\\s*("?)([^";]*)\\1\\s*;`).exec(POLICY);
    if (match === null) throw new Error(`UserNamePolicy.cs no longer declares ${name}, which this test reads.`);
    return match[2];
}

/** A name of a valid length with `character` in it, so the alphabet is the only thing being asked. */
const nameWith = (character: string) => `ab${character}`;

describe('userNameProblem, against the server\'s UserNamePolicy', () => {
    it('allows exactly the lengths the policy allows', () => {
        const min = Number(declared('MinLength'));
        const max = Number(declared('MaxLength'));

        expect([USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH]).toEqual([min, max]);
        expect(userNameProblem('a'.repeat(min))).toBeNull();
        expect(userNameProblem('a'.repeat(max))).toBeNull();
        expect(userNameProblem('a'.repeat(min - 1))).toBe(`A username is ${min} to ${max} characters long.`);
        expect(userNameProblem('a'.repeat(max + 1))).toBe(`A username is ${min} to ${max} characters long.`);
    });

    it('allows exactly the characters the policy allows', () => {
        // Every printable ASCII character, and some from beyond it that pass for one: a Cyrillic "а",
        // a fullwidth "Ａ" and "＿", an Arabic-Indic three and a no-break space — any of which would
        // let one name read as another.
        const allowed = declared('AllowedCharacters');
        const printable = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i));
        const beyond = ['é', 'ß', 'а', 'Ａ', '＿', '٣', ' '];

        for (const character of [...printable, ...beyond]) {
            const verdict = userNameProblem(nameWith(character)) === null ? 'allowed' : 'refused';
            expect(verdict, JSON.stringify(character)).toBe(allowed.includes(character) ? 'allowed' : 'refused');
        }
    });

    it('says which rule a name broke, length first', () => {
        // Too short and badly formed at once: the length is the sentence, as it is on the server.
        expect(userNameProblem('a-')).toBe(`A username is ${USERNAME_MIN_LENGTH} to ${USERNAME_MAX_LENGTH} characters long.`);
        expect(userNameProblem('al-ex')).toBe('A username can use letters, numbers and underscores only.');
    });
});
