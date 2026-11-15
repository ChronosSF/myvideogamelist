// Runs setup.mjs against a stand-in for Discord's API held in memory: a server as Community mode
// leaves it, with one human message in its rules channel. Dry run, apply, apply again, then the paths a
// second visit takes: a card whose words changed, the plain welcome an earlier version posted, a tag
// with no emoji, and an event whose start has passed.
import http from 'node:http';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./setup.mjs', import.meta.url));
const welcomeBytes = readFileSync(new URL('./assets/welcome.jpg', import.meta.url)).length;

const GUILD = '100';
const OWNER = '1';
const BOT = '900';

const state = {
    guild: { id: GUILD, name: 'Stand-in', owner_id: OWNER, features: ['COMMUNITY', 'NEWS'], rules_channel_id: '201', public_updates_channel_id: '202', default_message_notifications: 0 },
    channels: [
        { id: '300', type: 4, name: 'Text Channels', position: 0, parent_id: null, permission_overwrites: [] },
        { id: '301', type: 4, name: 'Voice Channels', position: 1, parent_id: null, permission_overwrites: [] },
        { id: '203', type: 0, name: 'general', position: 0, parent_id: '300', topic: null, permission_overwrites: [] },
        { id: '204', type: 2, name: 'General', position: 0, parent_id: '301', permission_overwrites: [] },
        // As Community mode makes them: read-only rules, and a channel only moderators see (bit 10, View Channel).
        { id: '201', type: 0, name: 'rules', position: 1, parent_id: null, topic: null, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: '2048' }] },
        { id: '202', type: 0, name: 'moderator-only', position: 2, parent_id: null, topic: null, permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: '1024' }] },
    ],
    roles: [
        { id: GUILD, name: '@everyone', permissions: '104324673' },
        { id: '500', name: 'setup bot', permissions: '8' },
    ],
    members: { [BOT]: { roles: ['500'] }, [OWNER]: { roles: [] } },
    invites: [{ code: 'pPnapgG3WU', channel: { id: '203', name: 'general' } }],
    rules: [],
    emojis: [],
    events: [],
    messages: { 201: [{ id: '700', type: 0, content: 'Be nice.', author: { id: OWNER }, pinned: false }] },
    writes: [],
};

let next = 1000;
const newId = () => String(next++);
let throttledOnce = false;
const withTagIds = tags => tags?.map(tag => ({ id: tag.id ?? newId(), moderated: false, emoji_id: null, emoji_name: null, ...tag }));
// A data URI whose bytes begin as its type says: a PNG's signature, or a JPEG's.
const isPng = value => typeof value === 'string' && value.startsWith('data:image/png;base64,iVBOR');
const isJpeg = value => typeof value === 'string' && value.startsWith('data:image/jpeg;base64,/9j/');

const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const type = request.headers['content-type'] ?? '';
    let body;
    const files = [];
    if (type.startsWith('multipart/form-data')) {
        // A file beside a message: the JSON in payload_json, each file in files[n].
        const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': type } }).formData();
        body = JSON.parse(form.get('payload_json'));
        for (const [key, value] of form) {
            const index = key.match(/^files\[(\d+)\]$/);
            if (index) files.push({ n: Number(index[1]), name: value.name, size: value.size });
        }
    } else if (chunks.length > 0) {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }
    const { pathname } = new URL(request.url, 'http://stand-in');
    const send = (status, data) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(data === undefined ? '' : JSON.stringify(data));
    };
    const { method } = request;

    if (request.headers.authorization !== 'Bot stub-token') return send(401, { message: '401: Unauthorized', code: 0 });
    if (!/^DiscordBot \(\S+, \S+\)/.test(request.headers['user-agent'] ?? '')) return send(403, { message: 'No valid user agent' });
    if (method !== 'GET' && !throttledOnce) {
        throttledOnce = true;
        return send(429, { message: 'You are being rate limited.', retry_after: 0.05, global: false });
    }
    if (method !== 'GET') state.writes.push(`${method} ${pathname}`);

    const route = (verb, pattern) => (method === verb ? pathname.match(pattern) : null);
    const channel = id => state.channels.find(other => other.id === id);
    /** What a message keeps of a request: its words, its embeds and buttons, and the files it names. */
    const messageParts = (before = []) => ({
        content: body.content ?? '',
        embeds: (body.embeds ?? []).map(embed => ({ type: 'rich', ...embed })),
        components: body.components ?? [],
        attachments: (body.attachments ?? []).map(named => {
            const file = files.find(other => other.n === named.id);
            if (!file) return before.find(kept => kept.id === String(named.id));
            return { id: newId(), filename: named.filename ?? file.name, size: file.size, url: `https://cdn.stand-in/${file.name}` };
        }),
    });
    let match;

    try {
        if (route('GET', /^\/users\/@me$/)) return send(200, { id: BOT, username: 'setup', bot: true });
        if (route('GET', /^\/users\/@me\/guilds$/)) return send(200, [{ id: GUILD, name: state.guild.name }]);
        if (route('GET', /^\/guilds\/100$/)) return send(200, state.guild);
        if (route('PATCH', /^\/guilds\/100$/)) { Object.assign(state.guild, body); return send(200, state.guild); }
        if (route('GET', /^\/guilds\/100\/channels$/)) return send(200, state.channels);
        if (route('GET', /^\/guilds\/100\/roles$/)) return send(200, state.roles);
        if (route('GET', /^\/guilds\/100\/invites$/)) return send(200, state.invites);
        if (route('GET', /^\/guilds\/100\/auto-moderation\/rules$/)) return send(200, state.rules);
        if (route('GET', /^\/guilds\/100\/emojis$/)) return send(200, state.emojis);
        if (route('GET', /^\/guilds\/100\/scheduled-events$/)) return send(200, state.events);
        if ((match = route('GET', /^\/guilds\/100\/members\/(\d+)$/))) return send(200, { user: { id: match[1] }, roles: state.members[match[1]].roles });

        if (route('POST', /^\/guilds\/100\/emojis$/)) {
            assert.match(body.name, /^\w{2,}$/, 'an emoji is named in letters, digits and underscores');
            assert.ok(isPng(body.image), 'an emoji is a PNG as a data URI');
            assert.ok(Buffer.from(body.image.split(',')[1], 'base64').length <= 256 * 1024, 'an emoji is 256 KiB at most');
            assert.deepEqual(body.roles, []);
            const created = { id: newId(), name: body.name, animated: false, available: true };
            state.emojis.push(created);
            return send(201, created);
        }
        if (route('POST', /^\/guilds\/100\/scheduled-events$/)) {
            assert.equal(body.privacy_level, 2);
            assert.equal(body.entity_type, 3, 'an event somewhere other than Discord');
            assert.equal(body.channel_id, null, 'which has no channel');
            assert.ok(body.entity_metadata.location.length <= 100);
            assert.ok(body.name.length <= 100 && body.description.length <= 1000);
            assert.ok(Date.parse(body.scheduled_end_time) > Date.parse(body.scheduled_start_time));
            assert.ok(Date.parse(body.scheduled_start_time) > Date.now(), 'an event starts in the future');
            assert.ok(isJpeg(body.image), 'the cover is a JPEG as a data URI');
            const created = { id: newId(), status: 1, ...body, image: 'hash' };
            state.events.push(created);
            return send(200, created);
        }
        if (route('POST', /^\/guilds\/100\/channels$/)) {
            assert.ok(body.name, 'a channel needs a name');
            if (body.parent_id) assert.equal(channel(body.parent_id)?.type, 4, 'the parent is a category');
            for (const tag of body.available_tags ?? []) {
                if (tag.emoji_id) assert.ok(state.emojis.some(emoji => emoji.id === tag.emoji_id), 'a tag wears an emoji of this server');
            }
            const created = {
                id: newId(), position: state.channels.filter(other => other.type === body.type).length, parent_id: null, topic: null,
                permission_overwrites: [], ...body, ...(body.available_tags && { available_tags: withTagIds(body.available_tags) }),
            };
            state.channels.push(created);
            return send(201, created);
        }
        if (route('PATCH', /^\/guilds\/100\/channels$/)) {
            for (const { id, position } of body) channel(id).position = position;
            return send(204);
        }
        if ((match = route('PATCH', /^\/channels\/(\d+)$/))) {
            const target = channel(match[1]);
            Object.assign(target, body, body.available_tags && { available_tags: withTagIds(body.available_tags) });
            return send(200, target);
        }
        if ((match = route('PUT', /^\/channels\/(\d+)\/permissions\/(\d+)$/))) {
            const target = channel(match[1]);
            target.permission_overwrites = [...target.permission_overwrites.filter(other => other.id !== match[2]), { id: match[2], ...body }];
            return send(204);
        }
        if (route('POST', /^\/guilds\/100\/roles$/)) {
            assert.equal(body.color, undefined, 'the deprecated colour field is not sent');
            const created = { id: newId(), ...body };
            state.roles.push(created);
            return send(200, created);
        }
        if ((match = route('PUT', /^\/guilds\/100\/members\/(\d+)\/roles\/(\d+)$/))) {
            state.members[match[1]].roles.push(match[2]);
            return send(204);
        }
        if (route('POST', /^\/guilds\/100\/auto-moderation\/rules$/)) {
            const created = { id: newId(), ...body };
            state.rules.push(created);
            return send(200, created);
        }
        if ((match = route('GET', /^\/channels\/(\d+)\/messages$/))) return send(200, [...(state.messages[match[1]] ?? [])].reverse());
        if ((match = route('POST', /^\/channels\/(\d+)\/messages$/))) {
            assert.ok((body.content ?? '').length <= 2000, 'a message is 2000 characters at most');
            if (body.embeds?.length) assert.ok(!((body.flags ?? 0) & 4), 'a card is not sent with its embeds suppressed');
            const created = { id: newId(), type: 0, author: { id: BOT }, pinned: false, ...messageParts() };
            (state.messages[match[1]] ??= []).push(created);
            return send(200, created);
        }
        if ((match = route('PATCH', /^\/channels\/(\d+)\/messages\/(\d+)$/))) {
            const message = state.messages[match[1]].find(other => other.id === match[2]);
            Object.assign(message, body.embeds || body.attachments ? messageParts(message.attachments) : { content: body.content });
            return send(200, message);
        }
        if ((match = route('PUT', /^\/channels\/(\d+)\/messages\/pins\/(\d+)$/))) {
            state.messages[match[1]].find(other => other.id === match[2]).pinned = true;
            return send(204);
        }
        return send(404, { message: `No stand-in for ${method} ${pathname}`, code: 0 });
    } catch (error) {
        // What Discord would refuse, said the way it says it.
        return send(400, { message: `Invalid Form Body: ${error.message}`, code: 50035 });
    }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const environment = { ...process.env, DISCORD_API_BASE: `http://127.0.0.1:${server.address().port}`, DISCORD_BOT_TOKEN: 'stub-token' };
// A start that stays in the future, whenever this is run.
const WHEN = ['--event-start', '2099-01-03T09:00:00Z', '--event-end', '2099-01-17T21:00:00Z'];
const setup = async (...flags) => (await run(process.execPath, [script, ...WHEN, ...flags], { env: environment })).stdout;
const changesIn = output => Number(output.match(/(\d+) changes? (?:would be )?made/)?.[1] ?? 0);

try {
    // 1. A dry run reads and writes nothing.
    const before = JSON.stringify({ ...state, writes: undefined });
    const dry = await setup();
    console.log(dry);
    assert.match(dry, /Dry run: nothing was changed\. \d+ changes would be made\./);
    assert.equal(state.writes.length, 0, 'a dry run sends no write');
    assert.equal(JSON.stringify({ ...state, writes: undefined }), before, 'a dry run leaves the server as it was');

    // 2. Applying makes the layout.
    const applied = await setup('--apply');
    console.log(applied);
    assert.equal(changesIn(applied), changesIn(dry), 'an apply makes the changes the dry run named');
    const named = name => state.channels.find(channel => channel.name === name);
    const group = name => state.channels.find(channel => channel.type === 4 && channel.name === name);
    for (const name of ['Info', 'The test', 'Community']) assert.ok(group(name), `the group ${name}`);
    assert.deepEqual(state.channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position).map(c => c.name),
        ['Info', 'The test', 'Community', 'Text Channels', 'Voice Channels']);
    assert.equal(named('welcome').parent_id, group('Info').id);
    assert.equal(named('rules').id, '201', 'the rules channel is the one Community made');
    assert.equal(named('rules').parent_id, group('Info').id);
    assert.equal(named('announcements').type, 5);
    assert.equal(named('bugs').type, 15);
    assert.equal(named('bugs').available_tags.length, 12);
    assert.equal(named('bugs').available_tags.filter(tag => tag.moderated).length, 5);
    assert.equal(named('feature-requests').default_reaction_emoji.emoji_name, '👍');
    assert.equal(named('general').id, '203', 'the channel the invite lands in is the same channel');
    assert.equal(named('general').parent_id, group('Community').id);
    assert.equal(state.channels.length, 6 + 3 + 6, 'nothing deleted: six there, three groups and six channels added');

    const everyone = name => named(name).permission_overwrites.find(overwrite => overwrite.id === GUILD);
    const bit = n => 1n << BigInt(n);
    assert.equal(BigInt(everyone('rules').deny), bit(11) | bit(35) | bit(36) | bit(38), 'rules: no sending, no threads');
    assert.equal(BigInt(everyone('send-an-export').allow), bit(36) | bit(38) | bit(15));
    assert.equal(BigInt(everyone('send-an-export').deny), bit(11) | bit(35));
    assert.equal(everyone('moderator-only').deny, '1024', 'the moderators channel is untouched');
    assert.equal(everyone('general'), undefined, 'general gets no overwrite');

    const developer = state.roles.find(role => role.name === 'Developer');
    assert.equal(developer.colors.primary_color, 0xa3e635);
    assert.equal(developer.permissions, '0');
    assert.ok(state.members[OWNER].roles.includes(developer.id), 'the owner is the developer');
    assert.ok(state.roles.some(role => role.name === 'Early tester'));
    assert.equal(state.guild.default_message_notifications, 1);
    assert.deepEqual(state.rules.map(rule => rule.trigger_type).sort(), [3, 5]);

    // The emojis, and the tags that wear them.
    assert.deepEqual(state.emojis.map(emoji => emoji.name), ['mvgl', 'backlog', 'playing', 'onhold', 'finished', 'dropped']);
    const emoji = name => state.emojis.find(other => other.name === name).id;
    const tag = (channel, name) => named(channel).available_tags.find(other => other.name === name);
    assert.equal(tag('bugs', 'Fixed').emoji_id, emoji('finished'));
    assert.equal(tag('bugs', 'New').emoji_id, emoji('backlog'));
    assert.equal(tag('bugs', "Can't reproduce").emoji_id, emoji('onhold'));
    assert.equal(tag('bugs', 'Mobile').emoji_id, null, 'an area tag wears nothing');
    assert.equal(tag('feature-requests', 'Not planned').emoji_id, emoji('dropped'));

    // The event.
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].name, 'MyVideoGameList open test');
    assert.equal(state.events[0].scheduled_start_time, '2099-01-03T09:00:00.000Z');
    assert.equal(state.events[0].entity_metadata.location, 'dev.myvideogamelist.net');

    // The welcome card and the texts.
    const texts = name => (state.messages[named(name).id] ?? []).filter(message => message.author.id === BOT);
    assert.equal(texts('welcome').length, 1);
    const card = texts('welcome')[0];
    assert.equal(card.content, '');
    assert.equal(card.embeds.length, 2);
    assert.equal(card.embeds[0].image.url, 'attachment://welcome.jpg');
    assert.equal(card.embeds[1].title, 'Welcome to MyVideoGameList');
    assert.ok(card.embeds[1].description.includes(`<#${named('bugs').id}>`), 'the welcome links the channels');
    assert.ok(!/\{\w+\}/.test(card.embeds[1].description), 'no placeholder left in the welcome');
    assert.deepEqual(card.components[0].components.map(button => [button.type, button.style, button.label, button.url]), [
        [2, 5, 'Open the test', 'https://dev.myvideogamelist.net'],
        [2, 5, 'Report a bug', `https://discord.com/channels/${GUILD}/${named('bugs').id}`],
        [2, 5, 'Request a feature', `https://discord.com/channels/${GUILD}/${named('feature-requests').id}`],
        [2, 5, 'Send an export', `https://discord.com/channels/${GUILD}/${named('send-an-export').id}`],
    ]);
    assert.deepEqual(card.attachments.map(file => [file.filename, file.size]), [['welcome.jpg', welcomeBytes]]);
    assert.equal(texts('send-an-export').length, 1);
    assert.ok(texts('send-an-export')[0].pinned, 'the export how-to is pinned');
    assert.equal(texts('rules').length, 0, 'nothing posted under the rules somebody already wrote');
    assert.match(applied, /already has somebody's messages/);

    // 3. A second run changes nothing, in either mode.
    let writes = state.writes.length;
    const again = await setup('--apply');
    console.log(again);
    assert.match(again, /Nothing needed changing\./);
    assert.equal(state.writes.length, writes, 'the second run sends no write');
    assert.match(await setup(), /already as the layout wants it/);

    // 4. A card whose words changed is edited in place, and keeps one picture.
    const words = card.embeds[1].description;
    card.embeds[1].description = 'Older words.';
    assert.match(await setup('--apply'), /update the welcome card in #welcome[\s\S]*Done: 1 change made\./);
    assert.equal(texts('welcome').length, 1);
    assert.equal(texts('welcome')[0].embeds[1].description, words);
    assert.equal(texts('welcome')[0].attachments.length, 1, 'the picture is replaced, not added to');

    // 5. The plain welcome an earlier version posted becomes the card.
    Object.assign(texts('welcome')[0], { content: '**Welcome to MyVideoGameList**\n\nOld plain text.', embeds: [], components: [], attachments: [] });
    assert.match(await setup('--apply'), /Done: 1 change made\./);
    assert.equal(texts('welcome')[0].content, '');
    assert.equal(texts('welcome')[0].embeds[1].description, words);

    // 6. A tag of ours with no emoji gets it; one somebody chose keeps what it has.
    tag('bugs', 'Fixed').emoji_id = null;
    Object.assign(tag('bugs', 'Confirmed'), { emoji_id: null, emoji_name: '🔥' });
    assert.match(await setup('--apply'), /#bugs: give 1 tag its emoji[\s\S]*Done: 1 change made\./);
    assert.equal(tag('bugs', 'Fixed').emoji_id, emoji('finished'));
    assert.equal(tag('bugs', 'Confirmed').emoji_name, '🔥');
    assert.equal(named('bugs').available_tags.length, 12, 'no tag made twice');

    // 7. An event whose start has passed is not created, and says so.
    state.events.length = 0;
    writes = state.writes.length;
    const late = (await run(process.execPath, [script, '--apply', '--event-start', '2020-01-01T09:00:00Z', '--event-end', '2020-01-15T09:00:00Z'], { env: environment })).stdout;
    assert.match(late, /has passed: not created/);
    assert.equal(state.events.length, 0);
    assert.equal(state.writes.length, writes);

    // 8. A wrong token stops it before anything.
    await assert.rejects(run(process.execPath, [script], { env: { ...environment, DISCORD_BOT_TOKEN: 'wrong' } }), /did not accept the token/);

    console.log('All checks passed.');
} finally {
    server.close();
}
