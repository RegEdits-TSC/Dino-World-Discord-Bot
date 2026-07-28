import 'dotenv/config';
import { REST, Routes, MessageFlags } from 'discord.js';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/core/config.js';
import { ALL_MODULES } from '../src/core/module-list.js';
import { ModuleRegistry } from '../src/core/modules.js';
import { setEmojiMap } from '../src/core/emojis.js';
import { FOODS } from '../src/data/foods.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import { RARITY } from '../src/data/rarity.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser, buildLot } from '../src/modules/park/service.js';
import { assignDino } from '../src/modules/park/dinos.js';
import { incubateEgg } from '../src/modules/hatchery/service.js';
import { startExpedition } from '../src/modules/expeditions/service.js';
import { createTrade } from '../src/modules/trading/service.js';
import { makeCtx, fakeCommand, fakeButton, type FakeInteraction } from '../tests/harness.js';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { Ctx } from '../src/core/context.js';

// ---- env -------------------------------------------------------------------
for (const name of ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DATABASE_PATH', 'OWNER_ID', 'DEV_GUILD_ID', 'TEST_CHANNEL_ID']) {
  if (!process.env[name]) { console.error(`test:live needs ${name} set in .env`); process.exit(1); }
}
const config = loadConfig();
const devGuildId = process.env.DEV_GUILD_ID!;
const testChannelId = process.env.TEST_CHANNEL_ID!;
const rest = new REST().setToken(config.token);

const failures: Array<{ step: string; error: string }> = [];
const passed: string[] = [];

// ---- 1. Discord validates every builder -------------------------------------
const registry = new ModuleRegistry(ALL_MODULES, Object.fromEntries(ALL_MODULES.map((m) => [m.name, true])));
try {
  const body = registry.commands().map((c) => c.data.toJSON());
  await rest.put(Routes.applicationGuildCommands(config.clientId, devGuildId), { body });
  passed.push(`deploy: ${body.length} builders accepted by Discord`);
} catch (e) {
  failures.push({ step: 'deploy builders', error: String(e) });
}

// ---- 2. Load the REAL emoji map so posted payloads use live tags -------------
try {
  const res = await rest.get(Routes.applicationEmojis(config.clientId)) as { items: Array<{ id: string; name: string; animated?: boolean }> };
  const entries: Record<string, string> = {};
  for (const e of res.items) entries[e.name] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`;
  setEmojiMap(entries);
  passed.push(`emoji map: ${res.items.length} live emojis loaded`);

  // Parity: every deployed-manifest name and FOODS emoji must exist remotely.
  const manifest = JSON.parse(readFileSync('assets/emojis/manifest.json', 'utf8')) as Record<string, string>;
  const remoteNames = new Set(res.items.map((i) => i.name));
  for (const name of Object.keys(manifest)) {
    if (!remoteNames.has(name)) failures.push({ step: 'emoji parity', error: `manifest emoji '${name}' missing on Discord` });
  }
  for (const f of Object.values(FOODS)) {
    if (!remoteNames.has(f.emoji)) failures.push({ step: 'emoji parity', error: `FOODS emoji '${f.emoji}' missing on Discord` });
  }
} catch (e) {
  failures.push({ step: 'emoji fetch', error: String(e) });
}

// ---- 3. Seed a representative sim world --------------------------------------
const ctx = makeCtx();
ctx.setNow(Date.now());   // real wall time so <t:...> timestamps render sensibly in the gallery
const P1 = 'live-p1', P2 = 'live-p2';
getOrCreateUser(ctx, P1, 'LiveTester');
getOrCreateUser(ctx, P2, 'Counterparty');
ctx.db.update(schema.users).set({ cash: 500_000, parkRating: 200, ratingHighWater: 400, shards: 600 }).run();
const herb = Object.keys(PADDOCKS).find((k) => PADDOCKS[k].diet === 'herbivore')!;
const lot = buildLot(ctx, P1, herb);
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'triceratops', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const dino = ctx.db.select().from(schema.dinos).all()[0];
assignDino(ctx, P1, dino.id, lot.id);
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'velociraptor', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
const readyEgg = ctx.db.insert(schema.eggs).values({ userId: P1, rarity: 'rare', source: 'shop', obtainedAt: ctx.now() }).returning().get();
incubateEgg(ctx, P1, readyEgg.id, devGuildId);
ctx.db.update(schema.eggs).set({ hatchesAt: ctx.now() - 1 }).run();   // force-ready for /hatch
// Inserted AFTER the force-ready update above so this one stays un-incubated for
// the /incubate case, which runs after hatch:crack frees the single incubator slot.
const spareEgg = ctx.db.insert(schema.eggs).values({ userId: P1, rarity: 'epic', source: 'shop', obtainedAt: ctx.now() }).returning().get();
const spareDino = ctx.db.select().from(schema.dinos).all()[1];
// buildLot/assignDino above ran recomputeRating, which unconditionally overwrote parkRating below TRADE_MIN_RATING — restore it so createTrade's rating gate passes.
ctx.db.update(schema.users).set({ parkRating: 200 }).run();
createTrade(ctx, P1, P2, { dinoIds: [spareDino.id], eggIds: [], cash: 0, foods: {} }, { dinoIds: [], eggIds: [], cash: 1000, foods: {} });
startExpedition(ctx, P1, 'coastal_dig', devGuildId);

// Battles seed: max-level squad + chapter 1 cleared to (not including) the boss,
// so one sweep shows the chapters overview, a normal 4-frame win, and a boss
// FIRST clear whose F4 carries the egg line. ratingHighWater 400 (set above)
// clears every site co-gate. ctx.sleep is makeCtx's instant stub, so the four
// editReply frames land immediately — the gallery posts them as four messages.
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'tyrannosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
ctx.db.insert(schema.dinos).values({ userId: P1, speciesId: 'spinosaurus', hunger: 100, lastFedAt: ctx.now(), hatchedAt: ctx.now() }).run();
ctx.db.update(schema.dinos).set({ battleXp: 10_000 }).where(eq(schema.dinos.userId, P1)).run();
const squad = ctx.db.select().from(schema.dinos).all().filter((d) => d.userId === P1 && !d.locked);
const [b1, b2, b3] = [squad[0], squad[squad.length - 2], squad[squad.length - 1]];
for (const stageId of ['coastal_dig_1', 'coastal_dig_2', 'coastal_dig_3', 'coastal_dig_4']) {
  ctx.db.insert(schema.battleProgress).values({ userId: P1, stageId, stars: 3, firstClearedAt: ctx.now(), attempts: 1 }).run();
}

// If any service signature above disagrees with the source, match the source —
// tests/*.test.ts show every call shape.

// ---- 4. Run cases and post their real payloads --------------------------------
interface Case { title: string; run(): Promise<FakeInteraction> }
const mod = (name: string) => ALL_MODULES.find((m) => m.name === name)!;
const cmdOf = (m: string, c: string) => mod(m).commands.find((x) => x.data.name === c)!;
const compOf = (m: string, p: string) => mod(m).components.find((x) => x.prefix === p)!;
const slash = async (m: string, c: string, opts: Parameters<typeof fakeCommand>[0]) => {
  const i = fakeCommand(opts);
  await cmdOf(m, c).execute(ctx as Ctx, i.asChatInput() as ChatInputCommandInteraction);
  return i;
};
const button = async (m: string, customId: string, user: string) => {
  const b = fakeButton({ customId, user });
  await compOf(m, customId.split(':')[0]).execute(ctx as Ctx, b.asInteraction() as unknown as ButtonInteraction);
  return b;
};

const cases: Case[] = [
  { title: '/help — overview', run: () => slash('help', 'help', { name: 'help', user: P1 }) },
  { title: '/park view — dashboard + render', run: () => slash('park', 'park', { name: 'park', sub: 'view', user: P1 }) },
  { title: '/eggs — list', run: () => slash('hatchery', 'eggs', { name: 'eggs', user: P1 }) },
  { title: '/hatch — pre-hatch embed', run: () => slash('hatchery', 'hatch', { name: 'hatch', user: P1, options: { egg: readyEgg.id } }) },
  { title: 'hatch:crack — reveal', run: () => button('hatchery', `hatch:crack:${readyEgg.id}`, P1) },
  { title: '/incubate — timer started', run: () => slash('hatchery', 'incubate', { name: 'incubate', user: P1, options: { egg: spareEgg.id } }) },
  { title: '/shop view — storefront', run: () => slash('shop', 'shop', { name: 'shop', sub: 'view', user: P1 }) },
  { title: '/shop food — purchase', run: () => slash('shop', 'shop', { name: 'shop', sub: 'food', user: P1, options: { item: 'ferns', units: 10 } }) },
  { title: '/sell — confirm prompt (ephemeral in production)', run: () => slash('shop', 'sell', { name: 'sell', user: P1, options: { dino: dino.id } }) },
  { title: '/mythic — confirm prompt (ephemeral in production)', run: () => slash('hatchery', 'mythic', { name: 'mythic', user: P1, options: { species: 'indominus' } }) },
  { title: '/expedition status — digging', run: () => slash('expeditions', 'expedition', { name: 'expedition', sub: 'status', user: P1 }) },
  { title: '/expedition claim — returned loot', run: () => {
      ctx.db.update(schema.expeditions).set({ returnsAt: ctx.now() - 1 }).run();   // force the seeded dig home
      return slash('expeditions', 'expedition', { name: 'expedition', sub: 'claim', user: P1 });
    } },
  { title: '/feed all — care banner', run: () => slash('care', 'feed', { name: 'feed', sub: 'all', user: P1 }) },
  { title: '/dino list — roster', run: () => slash('park', 'dino', { name: 'dino', sub: 'list', user: P1 }) },
  { title: '/trade list — pending trades', run: () => slash('trading', 'trade', { name: 'trade', sub: 'list', user: P1 }) },
  { title: '/top — leaderboard', run: () => slash('leaderboards', 'top', { name: 'top', user: P1, guild: devGuildId, options: { metric: 'rating' } }) },
  { title: '/admin inspect — (ephemeral in production)', run: () => slash('admin', 'admin', { name: 'admin', sub: 'inspect', user: 'owner', options: { user: P1 } }) },
  { title: '/battle chapters — campaign overview', run: () => slash('battles', 'battle', { name: 'battle', sub: 'chapters', user: P1 }) },
  { title: '/battle fight — all 4 cinematic frames (coastal_dig_1 win)', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_1', dino1: b1.id, dino2: b2.id } }) },
  { title: '/battle fight — boss FIRST clear: portrait thumb + egg line on F4', run: () => slash('battles', 'battle', { name: 'battle', sub: 'fight', user: P1, options: { stage: 'coastal_dig_boss', dino1: b1.id, dino2: b2.id, dino3: b3.id } }) },
];

type RawFilePayload = { data: Buffer; name: string };
function toPost(payload: unknown): { body: Record<string, unknown>; files: RawFilePayload[] } {
  const p: Record<string, unknown> = typeof payload === 'string' ? { content: payload } : { ...(payload as Record<string, unknown>) };
  delete p.flags;   // ephemeral flag is invalid on channel messages
  const files: RawFilePayload[] = [];
  // AttachmentBuilder.attachment is BufferResolvable (Buffer | string): assetImage() gives a file
  // path string, but withParkImage() (park render) gives an in-memory Buffer directly — reading
  // a Buffer as if it were a path would throw, so branch on which one we got.
  for (const f of (p.files as Array<{ attachment: Buffer | string; name: string }> | undefined) ?? []) {
    files.push({ data: Buffer.isBuffer(f.attachment) ? f.attachment : readFileSync(f.attachment), name: f.name });
  }
  delete p.files;
  p.embeds = ((p.embeds as Array<{ toJSON?: () => unknown }> | undefined) ?? []).map((e) => e.toJSON ? e.toJSON() : e);
  p.components = ((p.components as Array<{ toJSON?: () => unknown }> | undefined) ?? []).map((c) => c.toJSON ? c.toJSON() : c);
  return { body: p, files };
}

async function post(body: Record<string, unknown>, files: RawFilePayload[]): Promise<void> {
  await rest.post(Routes.channelMessages(testChannelId), { body, files });
}

await post({ content: `## Live sweep — ${new Date().toISOString()}` }, []);
for (const c of cases) {
  try {
    const i = await c.run();
    if (i.replies.length === 0) throw new Error('no reply captured');
    await post({ content: `**${c.title}**` }, []);
    for (const r of i.replies) {
      const { body, files } = toPost(r);
      await post(body, files);
    }
    passed.push(c.title);
  } catch (e) {
    failures.push({ step: c.title, error: String(e) });
  }
}

// ---- 5. Summary ----------------------------------------------------------------
console.log(`\n=== test:live summary ===`);
for (const p of passed) console.log(`  ok   ${p}`);
for (const f of failures) console.log(`  FAIL ${f.step}\n       ${f.error}`);
console.log(`${passed.length} ok, ${failures.length} failed. Cosmetic review: check <#${testChannelId}> in the dev guild.`);
process.exit(failures.length ? 1 : 0);
