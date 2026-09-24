/*
 * make-matcher-fixture.mjs — a Grouvee-shaped export that carries no IGDB ids, for exercising the
 * title matcher against the real IGDB.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * The matcher (ADR 0040) decides which IGDB game a title names, and the interesting half of that
 * decision is about data nobody controls: IGDB holds a row per *release*, so a search for a popular
 * game answers with several entries carrying its exact title, and what separates the canonical row
 * from its re-release stubs is how many people rate it.
 *
 * None of that can be exercised by the preset we have. A Grouvee export carries `igdb_id` on 606 of
 * 608 rows, so two rows reach the matcher and neither is chosen for being interesting. The unit
 * tests cover the rule with invented candidates; what they cannot cover is whether IGDB, today,
 * returns what the rule was written against.
 *
 * So this emits a file in Grouvee's shape with `igdb_id: null` on every row and twenty-odd titles
 * picked to land on a different branch each. Upload it, run the matcher, and compare what happened
 * with `--expectations`. It is a prediction, deliberately: a row that lands somewhere else is
 * either a bug or IGDB having moved, and both are worth knowing.
 *
 * It is also sized to make the matcher *loop*. There are twenty-two distinct normalised titles and
 * `ImportMatcher.MaxLookups` is twenty, so a full run takes two passes — which is the only way to
 * see that repeating a pass walks the job forwards instead of re-asking the same questions.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW TO RUN IT
 * ---------------------------------------------------------------------------------------------
 *   # From the repository root. The name matters: the preset sniffs for "grouvee".
 *   node scripts/make-matcher-fixture.mjs > grouvee-matcher-fixture.json
 *
 *   # What each row should become, as a table to check the result against.
 *   node scripts/make-matcher-fixture.mjs --expectations
 *
 * Then sign in, upload it at /import, and press "Find these games" twice — once per pass. The API
 * log carries one line per pass saying how many rows it answered and how many it resolved.
 *
 * Two things to know before you do. An account may hold three unreviewed jobs at once
 * (`ImportService.MaxPendingJobs`), so cancel something first if uploading is refused. And this
 * writes nothing until you commit it — cancelling the job at the end leaves no trace but the
 * `CachedGames` rows the matcher warmed, which are just IGDB metadata.
 *
 * ---------------------------------------------------------------------------------------------
 * WHERE THE EXPECTATIONS COME FROM
 * ---------------------------------------------------------------------------------------------
 * Rows marked `measured` were checked against live IGDB while ADR 0040 was written, and the note
 * carries the figures. Rows marked `predicted` follow from the rule but were never run, so they are
 * the ones most worth watching.
 */

/**
 * One row of the fixture.
 *
 * `year` is what the file claims, which is the only disambiguating signal a source without ids
 * gives us — null is the ordinary case for Backloggery and is deliberately the majority here.
 */
const CASES = [
    // ---------------------------------------------------------------- should resolve on its own
    {
        title: 'Hollow Knight',
        expect: 'matched',
        evidence: 'measured',
        why: 'Two IGDB rows carry this exact title: 2,248 ratings against none. Without the following signal a file with no year could not choose, which is every Backloggery row.',
    },
    {
        title: 'Hollow Knight',
        expect: 'matched',
        evidence: 'measured',
        why: 'A second copy of the row above. Two rows naming one game must cost one search (§M5).',
    },
    {
        title: 'hollow knight',
        expect: 'matched',
        evidence: 'measured',
        why: 'And a third, spelled differently. Grouping is on the normalised key, so case must not split it into a second search.',
    },
    {
        title: 'The Legend of Zelda: Ocarina of Time',
        expect: 'matched',
        evidence: 'measured',
        why: 'The canonical row (2,168 ratings) is only sixth in IGDB’s own results, behind a bundle, a Master Quest and a 2026 entry with no ratings. A ten-result pool would have matched the 2026 stub outright.',
    },
    {
        title: 'Assassins Creed 2',
        expect: 'matched',
        evidence: 'measured',
        why: 'Apostrophe dropped and a numeral typed as a digit: normalises onto "Assassin’s Creed II" (3,221 ratings), which then dominates a 2016 entry with 30.',
    },
    {
        title: 'Final Fantasy VII',
        expect: 'matched',
        evidence: 'measured',
        why: 'Seven IGDB rows carry this exact title — 1,633 ratings against 42, 18, 9 and three zeroes. The case that killed §M2’s "single candidate".',
    },
    {
        title: 'Final Fantasy 7',
        expect: 'matched',
        evidence: 'measured',
        why: 'The same game with the numeral the other way round. IGDB answers both spellings identically, and the roman fold makes both keys equal, so this must reach the same id as the row above and share its search.',
    },
    {
        title: 'Resident Evil 2',
        year: 1998,
        expect: 'matched',
        evidence: 'measured',
        why: 'Six rows carry this title. The year rules out the 2019 remake, and the two unrated 1998 rows beside the real one are no rivals — the year rule and the following rule composing into an answer neither gives alone.',
    },
    {
        title: 'Metal Gear Solid 3: Snake Eater',
        expect: 'matched',
        evidence: 'measured',
        why: 'The neighbours are all suffixed — HD Edition, Limited, Master Collection — so only one exact key survives and no following is needed.',
    },
    {
        title: 'Grim Fandango',
        expect: 'matched',
        evidence: 'measured',
        why: 'Its remaster is a separate IGDB row and a separate strict key, so the base game is matched and the remaster is not even offered.',
    },
    {
        title: 'Dark Souls: Remastered',
        expect: 'matched',
        evidence: 'measured',
        why: 'The edition exists in IGDB, so the conservative key finds it and the base game drops to an alternative. The other half of the two-key rule.',
    },
    {
        title: 'Ōkami',
        expect: 'matched',
        evidence: 'measured',
        why: 'Accents are stripped from both sides, so the macron does not matter. "Ōkami HD" keeps its suffix in the strict key and so cannot be chosen by mistake.',
    },
    {
        title: 'Super Mario Bros 3',
        expect: 'matched',
        evidence: 'measured',
        why: 'The missing full stop closes up, and the canonical row (1,739 ratings) sits seventh in the results behind four Super Mario Advance entries.',
    },
    {
        title: 'Wario Land 4',
        expect: 'matched',
        evidence: 'measured',
        why: 'The least-followed row here at 79 ratings, which is what ImportMatching.MinimumFollowing was set below.',
    },

    // ------------------------------------------------- should offer, and must not choose for you
    {
        title: 'Resident Evil 2',
        expect: 'ambiguous',
        evidence: 'measured',
        why: 'The same title as the row above with the year taken away. 604 ratings against 1,440 — both real, so the original and the remake are a question rather than an answer.',
    },
    {
        title: 'Doom',
        expect: 'ambiguous',
        evidence: 'measured',
        why: '1993 against 2016, 1,000 ratings against 1,949. Nobody can tell which one a file means.',
    },
    {
        title: 'Shadow of the Colossus',
        expect: 'ambiguous',
        evidence: 'measured',
        why: '1,339 against 389 — inside the dominance ratio, so still a question. The closest real pair measured, and what stops the ratio being set lower.',
    },
    {
        title: 'Prey',
        shelf: 'Gave Up On',
        expect: 'ambiguous',
        evidence: 'measured',
        why: 'Two unrelated games, 713 against 217. On a shelf we do not recognise as well, so the review screen has to show a candidate picker and a status dropdown on one row — a combination nothing else produces.',
    },
    {
        title: 'Portal 2 Game of the Year Edition',
        expect: 'ambiguous',
        evidence: 'predicted',
        why: 'No such IGDB row. The loose key reaches "Portal 2", which is worth offering and must never be chosen: the generous key can only ever offer.',
    },
    {
        title: 'Ratchet & Clank',
        expect: 'ambiguous',
        evidence: 'predicted',
        why: 'The ampersand becomes "and" on both sides. The 2002 original and the 2016 reimagining share the title exactly, so this turns on whether their followings are within a factor of ten.',
    },

    // ---------------------------------------------------------- should refuse to answer, on purpose
    {
        title: 'Dark Souls 4',
        expect: 'unmatched',
        evidence: 'predicted',
        why: 'A game that does not exist. "Dark Souls III" shares nine of eleven letter pairs with it and is a different number, so it must not be offered — this is the number guard, and an offer here is the guard failing.',
    },
    {
        title: 'GTA V',
        expect: 'unmatched',
        evidence: 'measured',
        why: 'IGDB returns Grand Theft Auto V, but nothing here knows the abbreviation expands. Refusing is right: guessing at initialisms is how a library gets the wrong game quietly.',
    },
    {
        title: 'Ocarina of Time',
        expect: 'unmatched',
        evidence: 'measured',
        why: 'IGDB does return the right game, and the subtitle alone is too far from the full title to clear the similarity floor. A miss rather than a mistake — and one of the two rows worth arguing about when the floor is retuned.',
    },
    {
        title: 'Pokemon Red',
        expect: 'unmatched',
        evidence: 'measured',
        why: 'IGDB calls it "Pokémon Red Version". The accent costs nothing; the trailing "Version" costs enough to fall under the floor. The other row worth arguing about — arguably the floor is too strict for a common way to write a common game.',
    },
    {
        title: 'Resedent Evil',
        expect: 'unmatched',
        evidence: 'measured',
        why: 'IGDB’s search is not fuzzy and returns nothing at all for this, so no score here can rescue a misspelled row. Included to keep that limitation visible rather than assumed away.',
    },
    {
        title: 'Zzzqqx Nonexistent Game',
        expect: 'unmatched',
        evidence: 'predicted',
        why: 'Nothing comes back. The ordinary end of a row that cannot be placed, and what the failure report is built from (§C5).',
    },
    {
        title: '- ??? -',
        expect: 'unmatched',
        evidence: 'predicted',
        why: 'Nothing survives normalising, so this is answered without a search at all. It still has to be *answered*: an unanswered row would be offered to every future pass for ever.',
    },
];

/** Grouvee writes one empty play row whenever a game is shelved, absent dates and all. */
const EMPTY_PLAY = {
    date_started: 'None',
    date_finished: 'None',
    seconds_played: 0,
    level_of_completion: 'Main Story',
    platform: '',
};

function entry(row, index) {
    return {
        id: 9000 + index,
        name: row.title,
        shelves: { [row.shelf ?? 'Played']: { date_added: '2026-02-11T09:15:00Z' } },
        platforms: { 'PC (Microsoft Windows)': { url: '' } },
        rating: row.expect === 'matched' ? 4 : null,
        review_title: '',
        review: '',
        dates: [EMPTY_PLAY],

        // The year the file claims. Grouvee writes a full date, and an absent one is the string
        // "None" rather than null — which the parser knows and nothing else should imitate.
        release_date: row.year ? `${row.year}-06-01` : 'None',
        date_added_to_collection: '2026-02-11',

        // The whole point. Every row goes to the matcher.
        igdb_id: null,
    };
}

function expectations() {
    const rows = CASES.map(row => [
        row.title,
        row.year ?? '—',
        row.expect,
        row.evidence,
        row.why,
    ]);

    const header = ['Title', 'Year in file', 'Should be', 'Evidence', 'Why'];
    const lines = [
        `| ${header.join(' | ')} |`,
        `|${header.map(() => '---').join('|')}|`,
        ...rows.map(cells => `| ${cells.join(' | ')} |`),
    ];

    const counted = kind => CASES.filter(row => row.expect === kind).length;

    return [
        ...lines,
        '',
        `${CASES.length} rows, ${new Set(CASES.map(r => r.title.toLowerCase())).size} distinct titles.`,
        `Expected: ${counted('matched')} matched, ${counted('ambiguous')} ambiguous, `
        + `${counted('unmatched')} unmatched.`,
    ].join('\n');
}

if (process.argv.includes('--expectations')) {
    console.log(expectations());
} else {
    console.log(JSON.stringify({
        export_format_version: 2,
        site: 'https://www.grouvee.com',
        account: { favorite_games: [] },
        collection: CASES.map(entry),
        play_log: [],
        reviews: [],
    }, null, 2));
}
