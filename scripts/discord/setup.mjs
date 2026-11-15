#!/usr/bin/env node
/**
 * Lays out the MyVideoGameList Discord server for the open test: three groups of channels, two roles,
 * six emojis, the notification default, two AutoMod rules, an event for the test, and the welcome card
 * and the rules and export texts.
 *
 *     node scripts/discord/setup.mjs              A dry run: reads the server and prints what it would change.
 *     node scripts/discord/setup.mjs --apply      Makes those changes.
 *
 *     --guild <id>            Which server, when the bot is in more than one.
 *     --skip-messages         Leave the welcome card and the texts out, to post them by hand.
 *     --event-start <when>    When the test's event starts and ends, as ISO 8601 (2026-11-21T09:00:00Z).
 *     --event-end <when>      The defaults are EVENT's, below.
 *
 * The pictures it uploads are in assets/ beside this file, drawn by draw.mjs. setup.test.mjs runs this
 * against a stand-in for Discord, by hand: nothing in CI does.
 *
 * The bot's token comes from DISCORD_BOT_TOKEN, or is asked for with the typing hidden. It is sent to
 * Discord and nowhere else, and never printed.
 *
 * What it will not do, on a server people are already in:
 *   - delete or rename a channel, a role or an emoji. An invite dies with the channel it was made in,
 *     and the site's own invite is in its footer, its terms and every post that points here;
 *   - overwrite a topic somebody wrote, or post under a text somebody else already posted;
 *   - take away a permission it did not set: an existing @everyone overwrite keeps its other bits;
 *   - change a forum tag's emoji once it has one.
 * A second run finds everything as wanted and changes nothing.
 *
 * The bot needs Administrator for the run. Read-only channels deny @everyone the right to send, and
 * only an administrator may post past that, or list every channel. Remove the bot afterwards.
 *
 * Every call is as Discord's documentation gave it on 15 November 2026 (docs.discord.com/developers):
 * API v10; pins at /channels/{id}/messages/pins/{message}; a role's colour as `colors.primary_color`;
 * a file as multipart `files[n]` beside `payload_json`, named by an embed as attachment://its-name.
 */
import { readFileSync } from 'node:fs';

const API = (process.env.DISCORD_API_BASE ?? 'https://discord.com/api/v10').replace(/\/$/, '');
// The format Discord requires of every client: DiscordBot ($url, $versionNumber).
const USER_AGENT = 'DiscordBot (https://myvideogamelist.net, 1.0)';
const REASON = 'Server setup script';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node scripts/discord/setup.mjs [--apply] [--guild <id>] [--skip-messages] [--event-start <when>] [--event-end <when>]');
    process.exit(0);
}
const option = name => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const APPLY = args.includes('--apply');
const SKIP_MESSAGES = args.includes('--skip-messages');
const GUILD_ARG = option('--guild');

/** The invite the site, its terms and the posts carry: DISCORD_INVITE_URL in the client's links.ts. */
const SITE_INVITE = 'pPnapgG3WU';
const SITE = 'https://dev.myvideogamelist.net';
/** The logo's lime: the Developer role, and the stripe down the welcome card. */
const LIME = 0xa3e635;

// Channel types.
const TEXT = 0;
const CATEGORY = 4;
const ANNOUNCEMENT = 5;
const FORUM = 15;
const TYPE_NAMES = { [TEXT]: 'text', [CATEGORY]: 'category', [ANNOUNCEMENT]: 'announcement', [FORUM]: 'forum', 2: 'voice', 13: 'stage', 16: 'media' };

// Permission bits. Discord sends and takes them as decimal strings, so they are BigInts here.
const ADMINISTRATOR = 1n << 3n;
const SEND_MESSAGES = 1n << 11n;
const ATTACH_FILES = 1n << 15n;
const CREATE_PUBLIC_THREADS = 1n << 35n;
const CREATE_PRIVATE_THREADS = 1n << 36n;
const SEND_MESSAGES_IN_THREADS = 1n << 38n;

/** Only the developer posts: a channel to read. */
const READ_ONLY = { allow: 0n, deny: SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PUBLIC_THREADS | CREATE_PRIVATE_THREADS };
/** Nothing in the channel itself: each member opens a private thread, seen by them and whoever manages threads. */
const PRIVATE_THREADS_ONLY = { allow: CREATE_PRIVATE_THREADS | SEND_MESSAGES_IN_THREADS | ATTACH_FILES, deny: SEND_MESSAGES | CREATE_PUBLIC_THREADS };

/** The site's mark and its five lists, each a 128 by 128 picture in assets/emoji. */
const EMOJIS = ['mvgl', 'backlog', 'playing', 'onhold', 'finished', 'dropped'];

const MODERATED = true;

/**
 * A tag only the developer may set is a state, and wears the list it reads as: waiting is the backlog,
 * under way is playing, done is finished, parked is on hold, turned down is dropped.
 */
const LAYOUT = [
    {
        category: 'Info',
        channels: [
            { key: 'welcome', name: 'welcome', type: TEXT, everyone: READ_ONLY, message: 'welcome', topic: 'What MyVideoGameList is, and how to help with the open test.' },
            // The one Community mode made, whatever it is called: Discord shows it to a new member as the rules.
            { key: 'rules', name: 'rules', type: TEXT, everyone: READ_ONLY, message: 'rules', isRulesChannel: true, topic: 'The rules of this server.' },
            { key: 'announcements', name: 'announcements', type: ANNOUNCEMENT, everyone: READ_ONLY, topic: 'The test, downtime, releases and the launch.' },
        ],
    },
    {
        category: 'The test',
        channels: [
            {
                key: 'bugs', name: 'bugs', type: FORUM,
                topic: 'One bug per post. Say what you did, what you expected and what happened. Add your device and browser, a screenshot if you can, and the trace id if an error page showed one. Never post your email or password.',
                tags: [
                    { name: 'New', moderated: MODERATED, emoji: 'backlog' },
                    { name: 'Confirmed', moderated: MODERATED, emoji: 'playing' },
                    { name: 'Fixed', moderated: MODERATED, emoji: 'finished' },
                    { name: "Can't reproduce", moderated: MODERATED, emoji: 'onhold' },
                    { name: 'Not a bug', moderated: MODERATED, emoji: 'dropped' },
                    { name: 'Lists' }, { name: 'Game page' }, { name: 'Import' }, { name: 'Profile and stats' },
                    { name: 'Calendar' }, { name: 'Account and sign-in' }, { name: 'Mobile' },
                ],
            },
            {
                key: 'requests', name: 'feature-requests', type: FORUM, reaction: '👍',
                topic: 'One request per post. Say what you are trying to do, not only the feature you would add. Search first: if it is already here, add a 👍 and a comment.',
                tags: [
                    { name: 'Under consideration', moderated: MODERATED, emoji: 'backlog' },
                    { name: 'Planned', moderated: MODERATED, emoji: 'playing' },
                    { name: 'Shipped', moderated: MODERATED, emoji: 'finished' },
                    { name: 'Not planned', moderated: MODERATED, emoji: 'dropped' },
                ],
            },
            { key: 'exports', name: 'send-an-export', type: TEXT, everyone: PRIVATE_THREADS_ONLY, message: 'exports', pin: true, topic: 'Export files from other trackers, each in a private thread.' },
        ],
    },
    {
        category: 'Community',
        channels: [
            { key: 'general', name: 'general', type: TEXT, topic: 'Talk about the site.' },
            { key: 'playing', name: 'now-playing', type: TEXT, topic: 'What you are playing.' },
        ],
    },
];

const ROLES = [
    // The logo's lime, shown apart in the member list. It grants nothing: the owner needs no grant.
    { name: 'Developer', colors: { primary_color: LIME, secondary_color: null, tertiary_color: null }, hoist: true, giveToOwner: true },
    // A thank-you, given by hand to whoever reports a bug or sends an export.
    { name: 'Early tester', colors: { primary_color: 0xd9f99d, secondary_color: null, tertiary_color: null }, hoist: false },
];

/**
 * The welcome, as a card: the banner, then the words under a title, then buttons that are links. `{key}`
 * is the channel of that key, as a link once it exists. The title is how a run finds its own card again.
 */
const WELCOME = {
    title: 'Welcome to MyVideoGameList',
    picture: 'welcome.jpg',
    body: `MyVideoGameList is a video game tracker: lists by status, a wishlist, scores, playthroughs with hours, your stats and a release calendar for your games. It is in open test at ${SITE}

**How to help**
• Found something broken? Post it in {bugs}
• Missing something? Post it in {requests}
• Use another tracker? Send its export in {exports}

What you add during the test is kept and moves to the real site at launch. News goes in {announcements}.`,
    buttons: [
        { label: 'Open the test', url: SITE },
        { label: 'Report a bug', channel: 'bugs' },
        { label: 'Request a feature', channel: 'requests' },
        { label: 'Send an export', channel: 'exports' },
    ],
};

/** The plain texts. The first line is how a run finds its own text again. */
const TEXTS = {
    rules: `**The rules**

1. Be decent to each other. No harassment, hate or personal attacks.
2. No spam or advertising. Ask before promoting something of your own.
3. Keep it safe for work, and mark game spoilers ||like this||.
4. One bug per post and one request per post. Search before you post.
5. No personal data in public channels, yours or anyone else's: no emails, passwords or export files.

Discord's Terms and Community Guidelines apply here too.`,

    exports: `**Sending an export from another tracker**

MyVideoGameList imports from Grouvee today. To add another tracker I need a real export file from it.

1. Export your library from your tracker, usually under Settings or Account.
2. In this channel, open Threads, choose Create, and switch on **Private Thread**. Only you and I can see it.
3. Attach the file and say which tracker it came from.

The file is used to build and test the import and nothing else. If the thread does not work for you, send it to me in a DM.`,
};

/**
 * The test, as an event somewhere other than Discord: it sits at the top of the channel list while it
 * runs. From the Saturday the posts go up, for two weeks; --event-start and --event-end say otherwise.
 */
const EVENT = {
    name: 'MyVideoGameList open test',
    start: option('--event-start') ?? '2026-11-21T09:00:00Z',
    end: option('--event-end') ?? '2026-12-05T21:00:00Z',
    location: 'dev.myvideogamelist.net',
    cover: 'event-cover.jpg',
    description: `MyVideoGameList is a video game tracker, open for testing at ${SITE}

Sign up, add your games and try to break it. Bugs go in #bugs, requests in #feature-requests, and export files from other trackers in #send-an-export.

What you add during the test is kept and moves to the real site at launch.`,
};

// ---------------------------------------------------------------------------------------------------

class ApiError extends Error {
    constructor(method, path, status, body) {
        super(`${method} ${path} answered ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
        this.status = status;
        this.code = typeof body === 'object' && body ? body.code : undefined;
    }
}

let token;

/** `body` is JSON, or a form when a file goes with it. */
async function request(method, path, body) {
    const isForm = body instanceof FormData;
    for (let attempt = 0; ; attempt++) {
        const response = await fetch(API + path, {
            method,
            headers: {
                Authorization: `Bot ${token}`,
                'User-Agent': USER_AGENT,
                // A form names its own type, with the boundary between its parts.
                ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
                ...(method === 'GET' ? {} : { 'X-Audit-Log-Reason': REASON }),
            },
            body: body === undefined || isForm ? body : JSON.stringify(body),
        });
        const text = await response.text();
        let data = null;
        if (text) {
            try { data = JSON.parse(text); } catch { data = text; }
        }
        if (response.status === 429 && attempt < 8) {
            // In seconds, as the body gives it or the header does. The emoji routes keep limits of their own.
            const seconds = Number(data?.retry_after ?? response.headers.get('retry-after') ?? 1);
            if (seconds > 2) console.log(`          Discord asks for a pause of ${Math.ceil(seconds)} seconds...`);
            await new Promise(resolve => setTimeout(resolve, Math.ceil(seconds * 1000) + 100));
            continue;
        }
        if (!response.ok) throw new ApiError(method, path, response.status, data);
        return data;
    }
}

const read = path => request('GET', path);

/** A picture from assets/, beside this file. */
function picture(name) {
    try {
        return readFileSync(new URL(`./assets/${name}`, import.meta.url));
    } catch {
        throw new Error(`assets/${name} is missing beside this script. Draw the pictures first: node scripts/discord/draw.mjs`);
    }
}

const mediaType = name => (name.endsWith('.png') ? 'image/png' : 'image/jpeg');

/** How Discord takes a picture inside JSON: an emoji, an event's cover. */
const dataUri = (name, bytes) => `data:${mediaType(name)};base64,${bytes.toString('base64')}`;

/** How it takes one beside a message: the JSON as `payload_json`, the file as `files[0]`. */
function withFile(payload, name, bytes) {
    const form = new FormData();
    form.set('payload_json', JSON.stringify(payload));
    form.set('files[0]', new Blob([bytes], { type: mediaType(name) }), name);
    return form;
}

let changes = 0;
const notes = [];

/** One change: printed in either mode, made only with --apply. Without it, `otherwise` stands in for the answer. */
async function change(line, perform, otherwise = null) {
    changes++;
    console.log(`  ${APPLY ? 'change' : 'would '}  ${line}`);
    return APPLY ? perform() : otherwise;
}

const ok = line => console.log(`  ok      ${line}`);
const note = line => { console.log(`  note    ${line}`); notes.push(line); };

function askHidden(prompt) {
    return new Promise((resolve, reject) => {
        const { stdin, stdout } = process;
        stdout.write(prompt);
        stdin.setRawMode(true);
        stdin.resume();
        stdin.setEncoding('utf8');
        let value = '';
        const finish = () => {
            stdin.setRawMode(false);
            stdin.pause();
            stdin.off('data', onData);
            stdout.write('\n');
        };
        function onData(chunk) {
            for (const character of chunk) {
                if (character === '\r' || character === '\n') { finish(); resolve(value.trim()); return; }
                if (character === '\u0003') { finish(); reject(new Error('Cancelled.')); return; }
                if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
                else if (character >= ' ') value += character;
            }
        }
        stdin.on('data', onData);
    });
}

async function readToken() {
    const fromEnvironment = process.env.DISCORD_BOT_TOKEN?.trim();
    if (fromEnvironment) return fromEnvironment;
    if (!process.stdin.isTTY) throw new Error('Set DISCORD_BOT_TOKEN, or run this in a terminal to be asked for the token.');
    const typed = await askHidden('Bot token (typing is hidden): ');
    if (!typed) throw new Error('No token given.');
    return typed;
}

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const byPosition = (a, b) => a.position - b.position || (BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// ---------------------------------------------------------------------------------------------------

async function main() {
    // Everything it would upload, before it asks for anything: a missing picture stops it here.
    const pictures = {
        welcome: picture(WELCOME.picture),
        cover: picture(EVENT.cover),
        emoji: Object.fromEntries(EMOJIS.map(name => [name, picture(`emoji/${name}.png`)])),
    };
    const eventStart = Date.parse(EVENT.start);
    const eventEnd = Date.parse(EVENT.end);
    if (Number.isNaN(eventStart) || Number.isNaN(eventEnd)) throw new Error('The event\'s start and end have to be dates, such as 2026-11-21T09:00:00Z.');
    if (eventEnd <= eventStart) throw new Error('The event has to end after it starts.');

    token = await readToken();
    console.log(APPLY ? 'Applying the layout.\n' : 'Dry run: nothing will be changed.\n');

    const me = await read('/users/@me');

    let guildId = GUILD_ARG;
    if (!guildId) {
        let guilds;
        try {
            guilds = await read('/users/@me/guilds');
        } catch (error) {
            if (error.status === 401) throw error;
            throw new Error(`Could not list the bot's servers (${error.message}). Say which with --guild <id>: with Developer Mode on, right-click the server and choose Copy Server ID.`);
        }
        if (guilds.length === 0) throw new Error('The bot is in no server yet. Invite it to yours first.');
        if (guilds.length > 1) {
            throw new Error(`The bot is in ${guilds.length} servers. Say which with --guild <id>:\n${guilds.map(g => `  ${g.id}  ${g.name}`).join('\n')}`);
        }
        guildId = guilds[0].id;
    }

    const guild = await read(`/guilds/${guildId}`);
    console.log(`Server: ${guild.name}`);

    let roles = await read(`/guilds/${guildId}/roles`);
    const member = await read(`/guilds/${guildId}/members/${me.id}`);
    const granted = roles
        .filter(role => role.id === guildId || member.roles.includes(role.id))
        .reduce((bits, role) => bits | BigInt(role.permissions), 0n);
    if ((granted & ADMINISTRATOR) === 0n) {
        throw new Error('The bot is not an administrator here. Give its role Administrator for this run (Server Settings, Roles), then run again.');
    }
    if (!guild.features.includes('COMMUNITY')) {
        throw new Error('This server is not a Community server. Switch that on first (Server Settings, Enable Community): the forums need it.');
    }

    const channels = await read(`/guilds/${guildId}/channels`);
    const byKey = {};

    // ---- The invite the site points at ----
    console.log('\nThe invite');
    const invites = await read(`/guilds/${guildId}/invites`);
    const siteInvite = invites.find(invite => invite.code === SITE_INVITE);
    if (siteInvite) ok(`discord.gg/${SITE_INVITE} lands in #${siteInvite.channel?.name ?? '?'}. Never delete that channel: the invite goes with it.`);
    else note(`discord.gg/${SITE_INVITE}, the invite the site and the posts carry, is not one of this server's invites.`);

    // ---- Emojis, before the forums whose tags wear them ----
    console.log('\nEmojis');
    const emojis = await read(`/guilds/${guildId}/emojis`);
    for (const name of EMOJIS) {
        if (emojis.some(emoji => emoji.name === name)) {
            ok(`:${name}:`);
            continue;
        }
        const created = await change(`add the emoji :${name}:`,
            () => request('POST', `/guilds/${guildId}/emojis`, { name, image: dataUri('emoji.png', pictures.emoji[name]), roles: [] }));
        if (created) emojis.push(created);
    }
    const emojiId = name => emojis.find(emoji => emoji.name === name)?.id;
    /** A tag as Discord takes one, wearing its emoji once the emoji exists. */
    const tagBody = tag => ({
        name: tag.name,
        moderated: Boolean(tag.moderated),
        ...(tag.emoji && emojiId(tag.emoji) && { emoji_id: emojiId(tag.emoji), emoji_name: null }),
    });

    // ---- Channels ----
    console.log('\nChannels');
    const createdCategory = [];
    for (const group of LAYOUT) {
        let category = channels.find(channel => channel.type === CATEGORY && sameName(channel.name, group.category));
        if (category) ok(`group "${group.category}"`);
        else {
            category = await change(`create the group "${group.category}"`,
                () => request('POST', `/guilds/${guildId}/channels`, { name: group.category, type: CATEGORY }));
            if (category) channels.push(category);
            createdCategory.push(group.category);
        }

        for (const spec of group.channels) {
            const label = `#${spec.name}`;
            if (spec.type === ANNOUNCEMENT && !guild.features.includes('NEWS')) {
                note(`${label} needs announcement channels, which this server does not have yet: not created.`);
                continue;
            }

            const existing = spec.isRulesChannel && guild.rules_channel_id
                ? channels.find(channel => channel.id === guild.rules_channel_id)
                : channels.find(channel => channel.type === spec.type && sameName(channel.name, spec.name));

            if (!existing) {
                const other = channels.find(channel => sameName(channel.name, spec.name));
                if (other) {
                    note(`${label} is already a ${TYPE_NAMES[other.type] ?? 'different'} channel, not a ${TYPE_NAMES[spec.type]} one: left as it is, and none created beside it.`);
                    continue;
                }
                const created = await change(`create the ${TYPE_NAMES[spec.type]} channel ${label} in "${group.category}"`,
                    () => request('POST', `/guilds/${guildId}/channels`, {
                        name: spec.name,
                        type: spec.type,
                        topic: spec.topic,
                        parent_id: category.id,
                        ...(spec.everyone && { permission_overwrites: [{ id: guildId, type: 0, allow: String(spec.everyone.allow), deny: String(spec.everyone.deny) }] }),
                        ...(spec.tags && { available_tags: spec.tags.map(tagBody) }),
                        ...(spec.reaction && { default_reaction_emoji: { emoji_id: null, emoji_name: spec.reaction } }),
                    }));
                if (created) channels.push(created);
                byKey[spec.key] = { spec, channel: created };
                continue;
            }

            const name = `#${existing.name}`;
            byKey[spec.key] = { spec, channel: existing };
            const patch = {};
            const parts = [];
            if (existing.parent_id !== category?.id) {
                patch.parent_id = category?.id;
                parts.push(`move into "${group.category}"`);
            }
            if (!existing.topic && spec.topic) {
                patch.topic = spec.topic;
                parts.push(spec.type === FORUM ? 'set the post guidelines' : 'set the topic');
            }
            if (spec.tags) {
                const have = existing.available_tags ?? [];
                const wantedFor = other => spec.tags.find(tag => sameName(tag.name, other.name));
                const missing = spec.tags.filter(tag => !have.some(other => sameName(other.name, tag.name)));
                // A tag of ours that wears nothing yet. One somebody gave an emoji keeps it.
                const bare = have.filter(other => wantedFor(other)?.emoji && !other.emoji_id && !other.emoji_name);
                if (missing.length > 0 && have.length + missing.length > 20) {
                    note(`${name} would pass Discord's limit of 20 tags: none added.`);
                } else if (missing.length > 0 || bare.length > 0) {
                    patch.available_tags = [
                        ...have.map(other => {
                            const id = bare.includes(other) ? emojiId(wantedFor(other).emoji) : undefined;
                            return id ? { ...other, emoji_id: id, emoji_name: null } : other;
                        }),
                        ...missing.map(tagBody),
                    ];
                    if (missing.length > 0) parts.push(`add ${plural(missing.length, 'tag')} (${missing.map(tag => tag.name).join(', ')})`);
                    if (bare.length > 0) parts.push(`give ${plural(bare.length, 'tag')} ${bare.length === 1 ? 'its' : 'their'} emoji`);
                }
            }
            if (spec.reaction && !existing.default_reaction_emoji) {
                patch.default_reaction_emoji = { emoji_id: null, emoji_name: spec.reaction };
                parts.push(`set ${spec.reaction} as the default reaction`);
            }
            if (parts.length > 0) {
                const updated = await change(`${name}: ${parts.join(', ')}`, () => request('PATCH', `/channels/${existing.id}`, patch));
                if (updated) Object.assign(existing, updated);
            }

            let overwriteChanged = false;
            if (spec.everyone) {
                // What is asked for, over what is there: any other bit of the overwrite stays as it was.
                const current = (existing.permission_overwrites ?? []).find(overwrite => overwrite.id === guildId);
                const allowNow = BigInt(current?.allow ?? '0');
                const denyNow = BigInt(current?.deny ?? '0');
                const allow = (allowNow | spec.everyone.allow) & ~spec.everyone.deny;
                const deny = (denyNow | spec.everyone.deny) & ~spec.everyone.allow;
                if (allow !== allowNow || deny !== denyNow) {
                    overwriteChanged = true;
                    await change(`${name}: ${spec.everyone === READ_ONLY ? 'make it read-only for everyone' : 'allow everyone private threads only'}`,
                        () => request('PUT', `/channels/${existing.id}/permissions/${guildId}`, { type: 0, allow: String(allow), deny: String(deny) }));
                }
            }
            if (parts.length === 0 && !overwriteChanged) ok(name);
        }
    }

    // ---- The three groups first, and everything that was there after them, in the order it had ----
    const categories = channels.filter(channel => channel.type === CATEGORY).sort(byPosition);
    const ours = LAYOUT.map(group => categories.find(channel => sameName(channel.name, group.category))).filter(Boolean);
    const wanted = [...ours, ...categories.filter(channel => !ours.includes(channel))];
    const outOfOrder = wanted.some((channel, index) => channel !== categories[index]);
    if (outOfOrder || (!APPLY && createdCategory.length > 0)) {
        await change(`put the groups in order: ${LAYOUT.map(group => group.category).join(', ')}, then what was already there`,
            () => request('PATCH', `/guilds/${guildId}/channels`, wanted.map((channel, index) => ({ id: channel.id, position: index }))));
    } else ok('the order of the groups');

    // ---- Roles ----
    console.log('\nRoles');
    for (const spec of ROLES) {
        let role = roles.find(other => sameName(other.name, spec.name));
        if (role) ok(`role "${role.name}"`);
        else {
            role = await change(`create the role "${spec.name}"`,
                () => request('POST', `/guilds/${guildId}/roles`, { name: spec.name, permissions: '0', colors: spec.colors, hoist: spec.hoist, mentionable: false }));
            if (role) roles = [...roles, role];
        }
        if (spec.giveToOwner) {
            const owner = await read(`/guilds/${guildId}/members/${guild.owner_id}`);
            if (role && owner.roles.includes(role.id)) ok(`the owner has "${spec.name}"`);
            else {
                await change(`give "${spec.name}" to the server's owner`,
                    () => request('PUT', `/guilds/${guildId}/members/${guild.owner_id}/roles/${role.id}`));
            }
        }
    }

    // ---- Settings ----
    console.log('\nSettings');
    if (guild.default_message_notifications === 1) ok('notifications default to @mentions only');
    else {
        await change('default notifications to @mentions only, so a message does not ping every member',
            () => request('PATCH', `/guilds/${guildId}`, { default_message_notifications: 1 }));
    }

    const moderation = await read(`/guilds/${guildId}/auto-moderation/rules`);
    // Trigger types 3 and 5, of which a server may have one each.
    if (moderation.some(rule => rule.trigger_type === 3)) ok('AutoMod already has a spam rule');
    else {
        await change('add the AutoMod rule "Block suspected spam"',
            () => request('POST', `/guilds/${guildId}/auto-moderation/rules`, { name: 'Block suspected spam', event_type: 1, trigger_type: 3, actions: [{ type: 1 }], enabled: true }));
    }
    if (moderation.some(rule => rule.trigger_type === 5)) ok('AutoMod already has a mention-spam rule');
    else {
        await change('add the AutoMod rule "Block mention spam" (more than 8 mentions in a message)',
            () => request('POST', `/guilds/${guildId}/auto-moderation/rules`, { name: 'Block mention spam', event_type: 1, trigger_type: 5, trigger_metadata: { mention_total_limit: 8 }, actions: [{ type: 1 }], enabled: true }));
    }

    // ---- The event ----
    console.log('\nThe event');
    const day = when => new Date(when).toUTCString().replace(':00 GMT', ' UTC');
    const events = await read(`/guilds/${guildId}/scheduled-events`);
    if (events.some(event => sameName(event.name, EVENT.name))) ok(`the event "${EVENT.name}"`);
    else if (eventStart <= Date.now()) note(`The event's start, ${day(eventStart)}, has passed: not created. Give a later one with --event-start.`);
    else {
        // Type 3 is somewhere other than Discord: no channel, a place and an end instead. Privacy 2 is the only one there is.
        await change(`create the event "${EVENT.name}", from ${day(eventStart)} to ${day(eventEnd)}, with its cover`,
            () => request('POST', `/guilds/${guildId}/scheduled-events`, {
                name: EVENT.name,
                privacy_level: 2,
                entity_type: 3,
                channel_id: null,
                entity_metadata: { location: EVENT.location },
                scheduled_start_time: new Date(eventStart).toISOString(),
                scheduled_end_time: new Date(eventEnd).toISOString(),
                description: EVENT.description,
                image: dataUri(EVENT.cover, pictures.cover),
            }));
    }

    // ---- The welcome card and the texts ----
    if (SKIP_MESSAGES) {
        console.log('\nTexts: skipped, as asked.');
    } else {
        console.log('\nTexts');
        const specOf = key => LAYOUT.flatMap(group => group.channels).find(channel => channel.key === key);
        const mention = key => (byKey[key]?.channel?.id ? `<#${byKey[key].channel.id}>` : `#${specOf(key).name}`);
        const fill = text => text.replace(/\{(\w+)\}/g, (_, key) => mention(key));
        // An ordinary message or a reply: a join notice in the channel is nobody's text.
        const somebodyWrote = messages => messages.some(message => message.author.id !== me.id && (message.type === 0 || message.type === 19));

        for (const { spec, channel } of Object.values(byKey)) {
            if (!spec.message) continue;
            const where = `#${channel?.name ?? spec.name}`;
            const isCard = spec.message === 'welcome';
            const what = isCard ? 'the welcome card' : `the ${spec.message} text`;
            if (!channel?.id) {
                // A dry run over a channel that is not there yet: the same lines an apply prints.
                await change(`post ${what} in ${where}`, () => null);
                if (spec.pin) await change(`pin it in ${where}`, () => null);
                continue;
            }
            const messages = await read(`/channels/${channel.id}/messages?limit=50`);

            if (isCard) {
                const buttons = WELCOME.buttons
                    .map(button => ({ label: button.label, url: button.url ?? (byKey[button.channel]?.channel?.id && `https://discord.com/channels/${guildId}/${byKey[button.channel].channel.id}`) }))
                    .filter(button => button.url);
                const card = {
                    content: '',
                    embeds: [
                        // The picture in an embed of its own, so that it is drawn above the words and not under them.
                        { color: LIME, image: { url: `attachment://${WELCOME.picture}` } },
                        { color: LIME, title: WELCOME.title, description: fill(WELCOME.body) },
                    ],
                    // A row (1) of buttons (2) that are links (5): they open an address and ask nothing of the bot.
                    components: [{ type: 1, components: buttons.map(button => ({ type: 2, style: 5, ...button })) }],
                    // Every file the message keeps: on an edit, the one before it goes.
                    attachments: [{ id: 0, filename: WELCOME.picture }],
                };
                const send = (method, path) => () => request(method, path, withFile(card, WELCOME.picture, pictures.welcome));

                // The card, or the plain text an earlier run of this posted.
                const mine = messages.find(message => message.author.id === me.id
                    && ((message.embeds ?? []).some(embed => embed.title === WELCOME.title) || (message.content ?? '').startsWith(`**${WELCOME.title}**`)));
                if (!mine) {
                    if (somebodyWrote(messages)) note(`${where} already has somebody's messages: ${what} was not posted there.`);
                    else await change(`post ${what} in ${where}`, send('POST', `/channels/${channel.id}/messages`));
                    continue;
                }
                const words = (mine.embeds ?? []).find(embed => embed.title === WELCOME.title);
                const file = (mine.attachments ?? []).find(attachment => attachment.filename === WELCOME.picture);
                const drawn = file ? file.size === pictures.welcome.length : (mine.embeds ?? []).some(embed => embed.image);
                const links = list => list.map(button => `${button.label} ${button.url}`).join('\n');
                const same = words?.description === card.embeds[1].description && drawn
                    && links(mine.components?.[0]?.components ?? []) === links(buttons);
                if (same) ok(`${what} in ${where}`);
                else await change(`update ${what} in ${where}`, send('PATCH', `/channels/${channel.id}/messages/${mine.id}`));
                continue;
            }

            const text = fill(TEXTS[spec.message]);
            const firstLine = text.split('\n')[0];
            const mine = messages.find(message => message.author.id === me.id && (message.content ?? '').startsWith(firstLine));
            if (mine) {
                if (mine.content === text) ok(`${what} in ${where}`);
                else await change(`update ${what} in ${where}`, () => request('PATCH', `/channels/${channel.id}/messages/${mine.id}`, { content: text }));
                if (spec.pin && !mine.pinned) await change(`pin it in ${where}`, () => request('PUT', `/channels/${channel.id}/messages/pins/${mine.id}`));
                continue;
            }
            if (somebodyWrote(messages)) {
                note(`${where} already has somebody's messages: ${what} was not posted there.`);
                continue;
            }
            // Flag 4 keeps a link from growing a preview under the text.
            const posted = await change(`post ${what} in ${where}`, () => request('POST', `/channels/${channel.id}/messages`, { content: text, flags: 4 }));
            if (spec.pin) await change(`pin it in ${where}`, () => request('PUT', `/channels/${channel.id}/messages/pins/${posted.id}`));
        }
    }

    // ---- What is left ----
    console.log('');
    if (!APPLY) {
        console.log(changes === 0
            ? 'Dry run: the server is already as the layout wants it.'
            : `Dry run: nothing was changed. ${plural(changes, 'change')} would be made. Run again with --apply to make ${changes === 1 ? 'it' : 'them'}.`);
    } else {
        console.log(changes === 0 ? 'Nothing needed changing.' : `Done: ${plural(changes, 'change')} made.`);
        console.log(`
Left to do by hand:
  - Rules screening (Server Settings, Safety Setup or Rules Screening): paste the rules there too.
  - Try the private thread in #send-an-export from a second account, before pointing anyone at it.
  - Delete a group this left empty, such as the default "Text Channels": the script deletes nothing.
  - Remove the bot from the server and reset its token in the developer portal.`);
    }
    if (notes.length > 0) console.log(`\nNotes:\n${notes.map(line => `  - ${line}`).join('\n')}`);
}

main().catch(error => {
    console.error(`\n${error.message}`);
    if (error.status === 401) console.error('Discord did not accept the token. Copy it again from the developer portal (Bot, Reset Token).');
    if (error.code === 60003) console.error('This server requires two-factor authentication for moderation: switch it on for the Discord account that owns the bot.');
    if (error.code === 50013 || error.code === 50001) console.error('The bot lacks a permission for that call. Check its role has Administrator.');
    if (APPLY && changes > 0) console.error('Some changes were made before this. It is safe to run again: what is done is skipped.');
    process.exit(1);
});
