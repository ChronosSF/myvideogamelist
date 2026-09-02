/*
 * seed-demo-history.mjs — generate a plausible tracking history for one local account.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------------------------
 * The profile statistics (ADR 0023) are derived from `UserGameEvents`, so they only say anything
 * once an account has months of history behind it. A fresh checkout has an empty database, which
 * means the profile page renders its empty state and nothing else — getting to a twelve-month
 * chart, a finish streak and a median time-to-finish by hand would take months of real clicking.
 *
 * This script produces that history in one command. It is useful for three things:
 *
 *   1. Looking at the feature at all, on a fresh checkout or after `docker compose down -v`.
 *   2. Exercising the metrics *together*. Each one has unit tests with two or three events; what
 *      no test covers is the twelve-month cap firing while a streak predates the visible window
 *      while one game is excluded from the median for never having been played and another is
 *      measured only up to its first finish. The data below is built to hit all of those at once.
 *   3. A regression check against PostgreSQL. The server unit tests run on the EF in-memory
 *      provider, which does not translate what PostgreSQL actually runs, so this is the only cheap
 *      way to confirm the real queries and projections behave. Run it with a fixed `--as-of` and
 *      the figures are byte-identical between runs, so `/api/user/stats` can be diffed.
 *
 * ---------------------------------------------------------------------------------------------
 * HOW TO RUN IT
 * ---------------------------------------------------------------------------------------------
 *   # From the repository root, with the database container up. --email is mandatory.
 *   node scripts/seed-demo-history.mjs --email bob2870@test.local \
 *     | docker exec -i mvgl-postgres psql -U mvgl -d myvideogamelist -v ON_ERROR_STOP=1
 *
 *   # Pin the end date, for figures that reproduce exactly between runs:
 *   node scripts/seed-demo-history.mjs --email bob2870@test.local --as-of 2026-09-02
 *
 * **It never opens a database connection.** It writes SQL to stdout and nothing else; piping that
 * into psql is a separate, deliberate act. That is what makes a seeding script safe to keep in a
 * repository — there is no argument, environment variable or mistake that causes it to write to a
 * database on its own, let alone a deployed one.
 *
 * The account must already exist — register it through the app first. The generated SQL looks the
 * user up by email and aborts with a clear message rather than inserting rows that point at
 * nothing.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT IT WRITES
 * ---------------------------------------------------------------------------------------------
 * One `DO` block, so the whole thing is a single transaction: either the account ends up with the
 * complete history or it is left exactly as it was.
 *
 * It is **idempotent per account**: it deletes that user's `UserGameEntries`, `UserGameEvents` and
 * `UserWishlistItems` first, so re-running replaces the history rather than doubling it. It
 * touches no other account and no other table. Point it at a real account and you will destroy
 * that account's lists, which is why `--email` is mandatory and has no default — there is no way
 * to run this and have it choose a target for you.
 *
 * The source of truth below is `GAMES`: one entry per game, with a timeline of status transitions.
 * Everything else is derived from it — one `UserGameEvents` row per consecutive pair of statuses,
 * and one `UserGameEntries` row carrying the last status, the score and the first and last
 * timestamps. That mirrors what `ListService` does at runtime, which is the property that matters:
 * the log and the current state agree, exactly as `docs/decisions/0018-*` requires.
 *
 * The game ids are **real IGDB ids**, taken from this project's own `/api/games`. A made-up id
 * would leave every entry unhydrated on the lists page, and the platform and genre breakdowns
 * empty — those are counted client-side from metadata the lists endpoint fetches from IGDB.
 *
 * ---------------------------------------------------------------------------------------------
 * DATES, AND WHY THERE IS AN ANCHOR
 * ---------------------------------------------------------------------------------------------
 * The timelines are written as real dates, because that is what makes them reviewable. They were
 * composed against `ANCHOR` — the date "today" was when this data was designed — and every one of
 * them is shifted forward by however long ago that was, so the history always ends at the present
 * day. Without that, running this a year from now would produce a chart whose recent months are
 * empty and whose current streak reads zero, which demonstrates nothing.
 *
 * Shifting preserves the *shape* — the fourteen-month span, the gaps, the on-hold intervals, the
 * runs of consecutive months. It does not guarantee identical per-month counts, because a finish
 * dated near the end of a month can slide into the next one. Pass `--as-of 2026-09-02` to disable
 * the shift and reproduce the reference figures exactly:
 *
 *   library    tracked 26, recorded 28, wishlisted 6, completionRate 0.7857
 *   scores     scored 16, mean 7.875, distribution [0,0,0,1,1,1,3,3,4,3]
 *   activity   logStartedAt 2025-07-05, 12 months, 61 transitions
 *              currentStreakMonths 3, longestStreakMonths 5
 *              timeToFinish samples 11, median 508.17h, longest 990.17h
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT EACH AWKWARD CASE IN THE DATA IS THERE TO PROVE
 * ---------------------------------------------------------------------------------------------
 *   The Witcher 3          Shelved for eight weeks mid-playthrough: 57 days elapsed, 41 active.
 *                          The difference is the whole reason ADR 0018 keeps intermediate
 *                          transitions, and the reason the metric is called active time.
 *   The Last of Us         Finished straight from the backlog, never marked as playing. It has no
 *                          playing interval, so it is excluded from the median rather than
 *                          counted as zero — 11 samples from 12 games ever finished.
 *   Elden Ring             Finished, then picked up again and currently playing. Only the first
 *                          finish is measured, so the open second playthrough cannot inflate it.
 *   Street Fighter 6       Dropped straight from the backlog, which still counts as "started" in
 *                          that month, because `IsStarted` is true for dropped. See ADR 0023.
 *   The Last of Us Rem.    Left every list, keeping its score. The removal is a real event with a
 *                          null target and is neither a finish nor a drop.
 *   Ōkami HD               Scored without ever being in a list — an entry with no status and no
 *                          events at all, which `setScore` creates. This plus the removal above
 *                          are why `recorded` (28) exceeds `tracked` (26).
 *   Baldur's Gate III      Wishlisted *and* currently playing. The wishlist is a separate axis
 *                          (ADR 0022), so the two are not exclusive and the page says so.
 *   Aug–Dec 2025           Five consecutive months with a finish — the longest streak, and
 *                          deliberately partly outside the twelve months the chart shows, so the
 *                          figure proves it comes from the whole log.
 *   Jun–Aug 2026           Three consecutive months with a finish, and nothing yet this month, so
 *                          the current streak reads 3 rather than 0 and the grace rule that stops
 *                          every streak breaking on the first of the month is exercised.
 */

const ARGS = process.argv.slice(2);

function arg(name, fallback) {
    const at = ARGS.indexOf(`--${name}`);
    return at === -1 ? fallback : ARGS[at + 1];
}

/**
 * Mandatory, with no default. This deletes the target account's lists before writing, so there
 * must be no way to run it and have it pick a victim on its own.
 *
 * An email rather than the user id, even though the id is what the rows actually carry. Nobody
 * knows their own GUID, so passing one means first querying `AspNetUsers` — and the output of that
 * query lists every account's id side by side, including your real one, which makes a copy-paste
 * slip land on a *valid* account instead of failing. A mistyped email aborts; a mistyped GUID
 * either aborts or quietly wipes the wrong person's lists. An email is also legible at the call
 * site, where `@test.local` is visible confirmation that the target is disposable.
 */
const EMAIL = arg('email', null);

if (EMAIL === null || EMAIL.startsWith('--')) {
    process.stderr.write([
        'Usage: node scripts/seed-demo-history.mjs --email <account> [--as-of YYYY-MM-DD]',
        '',
        'Writes SQL to stdout; it never connects to a database itself. Pipe it to psql:',
        '  node scripts/seed-demo-history.mjs --email bob@test.local \\',
        '    | docker exec -i mvgl-postgres psql -U mvgl -d myvideogamelist -v ON_ERROR_STOP=1',
        '',
        "This REPLACES the named account's lists, history and wishlist. Use a test account.",
        '',
    ].join('\n'));
    process.exit(1);
}

/** The date the timelines below were composed against. See "DATES" above. */
const ANCHOR = '2026-09-02';

/**
 * The date to generate the history up to, defaulting to today. Pass `--as-of 2026-09-02` — the
 * anchor itself — to disable the shift and reproduce the reference figures below exactly.
 */
const TODAY = arg('as-of', new Date().toISOString().slice(0, 10));

const DAY_MS = 86_400_000;
const SHIFT_DAYS = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${ANCHOR}T00:00:00Z`)) / DAY_MS);

if (!Number.isFinite(SHIFT_DAYS)) {
    process.stderr.write(`Unusable anchor date: ${TODAY}\n`);
    process.exit(1);
}

/** As seeded by the migration. Backlog is the only status whose `IsStarted` is false. */
const STATUS = { backlog: 1, playing: 2, on_hold: 3, finished: 4, dropped: 5 };

/**
 * Every game, with its transitions in order. A `null` status is a removal from every list.
 *
 * Dates are `YYYY-MM-DD HH:MM` in UTC, relative to `ANCHOR`. Times of day are varied only so the
 * data does not look machine-generated; nothing depends on them.
 */
const GAMES = [
    // --- Finished, with straightforward playing runs -------------------------------------------
    { id: 7346, title: 'The Legend of Zelda: Breath of the Wild', score: 9, timeline: [
        ['backlog', '2025-07-05 19:20'], ['playing', '2025-07-20 20:05'], ['finished', '2025-08-14 22:40'] ] },

    { id: 1942, title: 'The Witcher 3: Wild Hunt', score: 10, timeline: [
        ['backlog', '2025-07-06 11:00'], ['playing', '2025-08-02 18:30'], ['on_hold', '2025-08-20 23:10'],
        ['playing', '2025-09-05 19:45'], ['finished', '2025-09-28 21:15'] ] },

    { id: 26226, title: 'Celeste', score: 8, timeline: [
        ['playing', '2025-10-01 20:00'], ['finished', '2025-10-09 23:30'] ] },

    { id: 14593, title: 'Hollow Knight', score: 9, timeline: [
        ['backlog', '2025-08-15 09:30'], ['playing', '2025-10-05 21:00'], ['finished', '2025-10-27 22:50'] ] },

    { id: 113112, title: 'Hades', score: 9, timeline: [
        ['playing', '2025-11-02 17:40'], ['finished', '2025-11-24 20:20'] ] },

    { id: 72, title: 'Portal 2', score: 8, timeline: [
        ['backlog', '2025-09-10 12:15'], ['playing', '2025-12-03 19:00'], ['finished', '2025-12-07 21:40'] ] },

    { id: 19560, title: 'God of War', score: 9, timeline: [
        ['backlog', '2025-12-20 10:00'], ['playing', '2026-02-14 20:30'], ['on_hold', '2026-02-28 22:00'],
        ['playing', '2026-03-10 19:20'], ['finished', '2026-03-22 23:00'] ] },

    { id: 12517, title: 'Undertale', score: 7, timeline: [
        ['playing', '2026-06-02 18:00'], ['finished', '2026-06-06 22:30'] ] },

    { id: 26758, title: 'Super Mario Odyssey', score: 8, timeline: [
        ['backlog', '2026-01-08 08:45'], ['playing', '2026-07-04 16:00'], ['finished', '2026-07-25 20:10'] ] },

    { id: 7342, title: 'Inside', score: 7, timeline: [
        ['playing', '2026-08-10 21:00'], ['finished', '2026-08-13 22:15'] ] },

    // --- Finished without ever being played ----------------------------------------------------
    { id: 1009, title: 'The Last of Us', score: 10, timeline: [
        ['backlog', '2025-07-08 20:00'], ['finished', '2025-12-28 15:30'] ] },

    // --- Finished once, now on a second playthrough --------------------------------------------
    { id: 119133, title: 'Elden Ring', score: 10, timeline: [
        ['playing', '2026-08-01 19:30'], ['finished', '2026-08-20 23:50'], ['playing', '2026-08-25 20:00'] ] },

    // --- Dropped -------------------------------------------------------------------------------
    { id: 141503, title: 'Forza Horizon 5', score: 4, timeline: [
        ['backlog', '2025-09-01 14:00'], ['playing', '2025-11-10 19:00'], ['dropped', '2025-11-18 21:30'] ] },

    { id: 36926, title: 'Monster Hunter: World', score: 5, timeline: [
        ['playing', '2026-01-15 20:00'], ['dropped', '2026-02-02 22:00'] ] },

    { id: 191692, title: 'Street Fighter 6', score: null, timeline: [
        ['backlog', '2026-03-01 11:20'], ['dropped', '2026-05-12 18:40'] ] },

    // --- Currently playing ---------------------------------------------------------------------
    { id: 119171, title: "Baldur's Gate III", score: null, timeline: [
        ['backlog', '2026-04-02 09:00'], ['playing', '2026-08-28 20:30'] ] },

    { id: 25076, title: 'Red Dead Redemption 2', score: null, timeline: [
        ['playing', '2026-09-01 19:00'] ] },

    // --- Currently on hold ---------------------------------------------------------------------
    { id: 114283, title: 'Persona 5 Royal', score: null, timeline: [
        ['backlog', '2026-02-10 13:00'], ['playing', '2026-04-05 18:20'], ['on_hold', '2026-04-30 22:40'] ] },

    { id: 103337, title: 'Divinity: Original Sin II', score: null, timeline: [
        ['playing', '2026-05-20 20:00'], ['on_hold', '2026-06-15 21:50'] ] },

    // --- Backlog, never started ----------------------------------------------------------------
    { id: 112875, title: 'God of War Ragnarök', score: null, timeline: [['backlog', '2026-05-05 10:10']] },
    { id: 26845, title: 'Fire Emblem: Three Houses', score: null, timeline: [['backlog', '2026-06-20 15:30']] },
    { id: 203722, title: 'Dave the Diver', score: null, timeline: [['backlog', '2026-07-02 12:00']] },
    { id: 195517, title: 'Return to Monkey Island', score: null, timeline: [['backlog', '2026-07-19 17:45']] },
    { id: 31551, title: 'Final Fantasy XVI', score: null, timeline: [['backlog', '2026-08-05 09:15']] },
    { id: 75235, title: 'Ghost of Tsushima', score: null, timeline: [['backlog', '2026-08-22 20:00']] },
    { id: 134606, title: "Demon's Souls", score: null, timeline: [['backlog', '2026-08-30 11:30']] },

    // --- Left every list, kept its score -------------------------------------------------------
    { id: 6036, title: 'The Last of Us Remastered', score: 6, timeline: [
        ['backlog', '2025-08-20 19:00'], ['playing', '2025-09-15 20:30'], ['dropped', '2025-10-02 21:00'],
        [null, '2026-01-20 10:00'] ] },
];

/** Scored without ever being listed: an entry with a status of null and no events whatsoever. */
const SCORED_ONLY = [
    { id: 20744, title: 'Ōkami HD', score: 7, addedAt: '2026-07-11 21:00' },
];

/** Baldur's Gate III is also in a list on purpose — the wishlist is a separate axis (ADR 0022). */
const WISHLIST = [
    { id: 119171, title: "Baldur's Gate III", at: '2026-04-01 08:30' },
    { id: 144024, title: 'Final Fantasy VII Remake Intergrade', at: '2026-06-11 19:00' },
    { id: 112874, title: 'Horizon Forbidden West', at: '2026-07-03 20:15' },
    { id: 168670, title: 'Uncharted: Legacy of Thieves Collection', at: '2026-07-28 12:40' },
    { id: 122238, title: 'Xenoblade Chronicles: Definitive Edition', at: '2026-08-09 16:00' },
    { id: 19686, title: 'Resident Evil 2', at: '2026-08-27 21:30' },
];

/** `YYYY-MM-DD HH:MM` shifted off the anchor, as a PostgreSQL timestamptz literal. */
function stamp(local) {
    const at = new Date(`${local.replace(' ', 'T')}:00Z`);
    at.setUTCDate(at.getUTCDate() + SHIFT_DAYS);
    return `'${at.toISOString().replace('T', ' ').slice(0, 19)}+00'::timestamptz`;
}

const statusId = key => (key === null ? 'NULL' : STATUS[key]);
const score = value => (value === null ? 'NULL' : value);

/** Single-quotes doubled, in case an email ever arrives with one in it. */
const literal = value => `'${String(value).replace(/'/g, "''")}'`;

const out = [];
const write = line => out.push(line);

write(`-- Generated by scripts/seed-demo-history.mjs for ${EMAIL}`);
write(`-- Timelines anchored at ${ANCHOR}, shifted ${SHIFT_DAYS} day(s) to land on ${TODAY}.`);
write('--');
write('-- One DO block, so this is a single transaction: the account ends up with the whole');
write('-- history or is left exactly as it was.');
write('DO $seed$');
write('DECLARE');
write('    seed_user text;');
write('BEGIN');
write(`    SELECT "Id" INTO seed_user FROM "AspNetUsers" WHERE "Email" = ${literal(EMAIL)};`);
write('');
write('    -- Aborts with something readable rather than letting every insert fail on a null id.');
write('    IF seed_user IS NULL THEN');
write(`        RAISE EXCEPTION 'No account %. Register it through the app first.', ${literal(EMAIL)};`);
write('    END IF;');
write('');
write('    -- Idempotent per account: replaces this history rather than doubling it.');
write('    DELETE FROM "UserGameEvents" WHERE "UserId" = seed_user;');
write('    DELETE FROM "UserWishlistItems" WHERE "UserId" = seed_user;');
write('    DELETE FROM "UserGameEntries" WHERE "UserId" = seed_user;');
write('');

for (const game of GAMES) {
    const [, firstAt] = game.timeline[0];
    const [lastStatus, lastAt] = game.timeline.at(-1);

    write(`    -- ${game.title}`);
    write('    INSERT INTO "UserGameEntries"'
        + ' ("UserId", "GameId", "StatusId", "Score", "AddedAt", "StatusChangedAt") VALUES');
    write(`        (seed_user, ${game.id}, ${statusId(lastStatus)}, ${score(game.score)},`
        + ` ${stamp(firstAt)}, ${stamp(lastAt)});`);

    write('    INSERT INTO "UserGameEvents"'
        + ' ("UserId", "GameId", "FromStatusId", "ToStatusId", "OccurredAt") VALUES');

    let from = null;
    const rows = game.timeline.map(([to, at]) => {
        const row = `        (seed_user, ${game.id}, ${statusId(from)}, ${statusId(to)}, ${stamp(at)})`;
        from = to;
        return row;
    });
    write(`${rows.join(',\n')};`);
    write('');
}

for (const game of SCORED_ONLY) {
    write(`    -- ${game.title} — scored but never listed, so it has no events at all`);
    write('    INSERT INTO "UserGameEntries"'
        + ' ("UserId", "GameId", "StatusId", "Score", "AddedAt", "StatusChangedAt") VALUES');
    write(`        (seed_user, ${game.id}, NULL, ${score(game.score)}, ${stamp(game.addedAt)}, NULL);`);
    write('');
}

write('    -- Wishlist. A separate axis, so one of these is also in a status list.');
write('    INSERT INTO "UserWishlistItems" ("UserId", "GameId", "AddedAt") VALUES');
write(WISHLIST.map(item => `        (seed_user, ${item.id}, ${stamp(item.at)})`).join(',\n') + ';');
write('END');
write('$seed$;');

process.stdout.write(out.join('\n') + '\n');
