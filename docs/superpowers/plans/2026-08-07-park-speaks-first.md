# The Park Speaks First — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the bot warn players before they lose a dino to an escape or lose income to the park's earning cap, and make every passive notification actionable from where it lands.

**Architecture:** One self-re-arming `alert_sweep` timer runs every 15 minutes, recomputes two predicates fresh from `toClockDinos`, and level-triggers against an `alerts_sent` idempotency table — a record that a side effect happened, never a derived value. Delivery is DM-only. Separately, every passive notification gains action buttons, and a shipped defect that made channel notifications silent is repaired.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js v14, drizzle-orm + better-sqlite3 (synchronous), vitest.

**Spec:** `docs/superpowers/specs/2026-08-07-park-speaks-first-design.md`

## Global Constraints

These apply to every task. Violating any of them fails review.

- **ESM NodeNext:** every relative import carries a `.js` extension, including in tests.
- **Time from `ctx.now()`, randomness from `ctx.rng()`** — never `Date.now()` or `Math.random()` in `src/`.
- **DB access is synchronous** drizzle/better-sqlite3 — `.get()` / `.all()` / `.run()`, never awaited.
- **Never call `emojiTag()` in a module-level constant.** The app-emoji map loads after client ready, so module init would freeze the unicode fallback permanently.
- **Never pass `rarityEmoji(...)` to `ButtonBuilder.setEmoji`** — it returns `''` with no map loaded and the builder throws rather than degrading.
- **Wire embed art with `attach(embed, payload, slot, assetImage(...))`**, never `payload.files = [...]` — `tests/images.test.ts` bans the latter outright.
- **`attachments` rules point in opposite directions:**
  - On an `i.update` replacing a file-bearing message: include `attachments: []`.
  - On a payload reaching `deliverNotification`: include **no** `attachments` key. That function forwards one object to two send sites (`src/core/notify.ts:33` then `:37`) and `MessagePayload.resolveBody` pushes into an explicit array in place.
- **`npm run typecheck`** (not `npm test`, not `npm run build`) is the only gate that typechecks `tests/` and `scripts/`. Run it before every commit that touches either.
- **No authorship attribution** in any commit message, comment, or doc — no "Co-Authored-By", no "Generated with", no mention of AI or assistants.
- Commit messages: imperative mood, no trailers.

---

## File Structure

**Created:**
- `src/modules/park/alert-record.ts` — the `alerts_sent` idempotency layer. Knows nothing about escapes or income.
- `src/modules/park/alert-detect.ts` — the two pure predicates. No DB writes, no Discord types.
- `src/modules/park/alert-embeds.ts` — the combined alert payload and its button row.
- `src/modules/park/alert-sweep.ts` — the timer: arming, the handler, the per-user fan-out.
- `drizzle/0009_park_alerts.sql` — migration.
- `tests/alert-record.test.ts`, `tests/alert-detect.test.ts`, `tests/alert-sweep.test.ts`, `tests/alert-buttons.test.ts`

**Modified:**
- `src/core/db/schema.ts` — `users.alertsEnabled`, new `alertsSent` table.
- `src/core/notify.ts` — widen `NotifyPayload`; repair `withMention`.
- `src/modules/trading/index.ts:126-130` — same ping repair, correct the false comment.
- `src/modules/park/index.ts` — `/park alerts` subcommand, the subcommand dispatch fix, the `alert` component prefix (appended).
- `src/modules/expeditions/index.ts` — new `exp` component prefix.
- `src/modules/genelab/index.ts` — new `claim` action on the existing `breed` prefix.
- `src/modules/hatchery/embeds.ts` — export a reusable `crackButton` row (already exists; confirm export).
- `src/index.ts` — register `alert_sweep`, call `armAlertSweep`.
- `src/modules/admin/service.ts` — `adminReset` deletes `alerts_sent`.
- `src/modules/daily/hooks.ts` — `alert` joins `EXEMPT_PREFIXES`.
- `src/modules/help/index.ts` — `park` and `care` topics.
- `scripts/test-live.ts` — gallery coverage.
- `docs/commands.md`, `docs/gameplay.md`, `docs/ops.md`, `CLAUDE.md`.

Why four alert files rather than one: the record layer is pure persistence, the detect layer is pure computation, the embeds layer is pure presentation, and the sweep is the only piece that touches the scheduler, the `Sender`, and the clock at once. Each is independently testable, and only the sweep needs a fake `Sender`.

---

### Task 1: Migration 0009 — the flag and the record table

**Files:**
- Modify: `src/core/db/schema.ts:4-25` (users), and append a new table after `userStats`
- Create: `drizzle/0009_park_alerts.sql`
- Modify: `drizzle/meta/_journal.json`
- Test: `tests/migration.test.ts` (append a describe block)

**Interfaces:**
- Consumes: nothing.
- Produces: `schema.users.alertsEnabled` (boolean, default `true`); `schema.alertsSent` with columns `userId, kind, refId, tier, firedForMs, sentAt` and PK `(userId, kind, refId, tier)`.

- [ ] **Step 1: Add the column and the table to the drizzle schema**

In `src/core/db/schema.ts`, add one line to `users` immediately after `lastQuestClaimAt`:

```ts
  lastQuestClaimAt: integer('last_quest_claim_at_ms').notNull().default(0),
  // Gates ONLY the two proactive alerts (escape, income cap). The three completion
  // notifications stay unconditional: those were asked for by starting the hatch,
  // the breeding, the expedition. adminReset deliberately does not restore this —
  // see the comment in admin/service.ts.
  alertsEnabled: integer('alerts_enabled', { mode: 'boolean' }).notNull().default(true),
```

Then append a new table after the `userStats` declaration:

```ts
// Idempotency record for the proactive alert sweep. This is NOT derived state: it
// records that a side effect (a DM) happened, so it can never drift the way a stored
// escapeAt would. The sweep sends iff the condition holds now AND no row exists whose
// firedForMs equals the current instant.
//   kind:  'escape' | 'income_cap'
//   refId: dinoId for escape, 0 for income_cap
//   tier:  'heads_up' | 'last_call' for escape, '' for income_cap
export const alertsSent = sqliteTable('alerts_sent', {
  userId: text('user_id').notNull().references(() => users.discordId),
  kind: text('kind').notNull(),
  refId: integer('ref_id').notNull(),
  tier: text('tier').notNull(),
  firedForMs: integer('fired_for_ms').notNull(),
  sentAt: integer('sent_at_ms').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.kind, t.refId, t.tier] })]);
```

`primaryKey`, `text`, `integer`, and `sqliteTable` are already imported at the top of the file.

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`

Expected: a new `drizzle/0009_*.sql` and a new `_journal.json` entry with `"idx": 9`. **Rename the generated `.sql` to `0009_park_alerts.sql` and update its `tag` in `_journal.json` to `"0009_park_alerts"`** to match the repo's naming.

**Verify the emitted SQL is an ALTER, not a table recreate.** It must look like:

```sql
ALTER TABLE `users` ADD `alerts_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE TABLE `alerts_sent` (
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref_id` integer NOT NULL,
	`tier` text NOT NULL,
	`fired_for_ms` integer NOT NULL,
	`sent_at_ms` integer NOT NULL,
	PRIMARY KEY(`user_id`, `kind`, `ref_id`, `tier`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`discord_id`) ON UPDATE no action ON DELETE no action
);
```

If drizzle-kit emits a `__new_users` / `DROP TABLE users` recreate instead, stop and hand-write the ALTER form above — a recreate would fail `DROP TABLE` against child rows on a populated DB even with `migrateDb`'s FK bracket, because drizzle runs each migration inside a transaction where `PRAGMA foreign_keys` is a no-op. `drizzle/0008_world_broadcast.sql` is the precedent for the ALTER form.

- [ ] **Step 3: Write the failing migration test**

Append to `tests/migration.test.ts`. This mirrors the existing "production path" block at `:374-412` — a scratch folder, the journal filtered to the previous migration, `foreign_keys = ON`, and a **parent user plus a child dino** so the FK the migrator must not trip over is actually present.

```ts
describe('0009 park alerts via the real drizzle migrator (production path)', () => {
  it('adds alerts_enabled defaulting to on, creates alerts_sent, and preserves existing rows', () => {
    const scratch = mkdtempSync(resolve(tmpdir(), 'dw-mig9-'));
    mkdirSync(resolve(scratch, 'meta'), { recursive: true });
    for (const f of readdirSync(DRIZZLE).filter((f) => /^000[0-8].*\.sql$/.test(f))) {
      cpSync(resolve(DRIZZLE, f), resolve(scratch, f));
    }
    const journal = JSON.parse(readFileSync(resolve(DRIZZLE, 'meta/_journal.json'), 'utf8'));
    journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 8);
    writeFileSync(resolve(scratch, 'meta/_journal.json'), JSON.stringify(journal));

    const sqlite = new Database(':memory:');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: scratch });   // apply 0000-0008 only

    sqlite.prepare(`INSERT INTO users (discord_id, last_collect_at_ms, created_at_ms) VALUES ('u1', 0, 0)`).run();
    sqlite.prepare(`INSERT INTO dinos (user_id, species_id, hunger, last_fed_at_ms, hatched_at_ms)
                    VALUES ('u1', 'triceratops', 100, 0, 0)`).run();

    try {
      expect(() => migrateDb(db)).not.toThrow();
      // A row that predates the column defaults to alerts ON.
      const users = sqlite.prepare(`SELECT discord_id, alerts_enabled FROM users`).all() as
        Array<{ discord_id: string; alerts_enabled: number }>;
      expect(users).toEqual([{ discord_id: 'u1', alerts_enabled: 1 }]);
      // The child row the FK bracket exists to protect survived.
      expect((sqlite.prepare(`SELECT COUNT(*) c FROM dinos`).get() as { c: number }).c).toBe(1);
      // alerts_sent exists and enforces its composite primary key.
      sqlite.prepare(`INSERT INTO alerts_sent (user_id, kind, ref_id, tier, fired_for_ms, sent_at_ms)
                      VALUES ('u1', 'escape', 1, 'heads_up', 500, 100)`).run();
      expect(() => sqlite.prepare(`INSERT INTO alerts_sent (user_id, kind, ref_id, tier, fired_for_ms, sent_at_ms)
                      VALUES ('u1', 'escape', 1, 'heads_up', 900, 200)`).run()).toThrow();
      expect((sqlite.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number }).foreign_keys).toBe(1);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/migration.test.ts`
Expected: PASS. If it fails on a missing `alerts_enabled` column, the journal entry for idx 9 is missing or its `when` does not sort after 0008's `1785982031959`.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: both pass. The new column is additive with a default, so no existing fixture needs updating.

- [ ] **Step 6: Commit**

```bash
git add src/core/db/schema.ts drizzle/ tests/migration.test.ts
git commit -m "Add the alerts_enabled flag and the alerts_sent record table"
```

---

### Task 2: Widen the notification payload and repair the ping

**Files:**
- Modify: `src/core/notify.ts:12` (type), `:20-26` (`withMention`), `:62`, `:76`, `:91` (local payload types)
- Modify: `src/modules/world/embeds.ts:11` (`Payload`)
- Modify: `src/modules/trading/index.ts:126-130`
- Test: `tests/notify.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `NotifyPayload` now accepts optional `components?: ActionRowBuilder<ButtonBuilder>[]` and `allowedMentions?: { users?: string[]; parse?: [] }`. `withMention(userId, payload)` now returns a payload carrying `allowedMentions: { users: [userId] }`.

**Why this task exists:** `src/index.ts:32` sets `allowedMentions: { parse: [] }` client-wide, deliberately, so `/dino rename` and `/park rename` cannot echo a user-supplied role mention into public content. The consequence nobody recorded is that `withMention`'s `<@id>` renders as an inert grey chip — **every channel-routed notification has notified nobody since it shipped**. A per-message `allowedMentions` replaces the client default rather than merging with it, so whitelisting exactly one user id restores the ping while keeping the rename echo-safety fully intact.

- [ ] **Step 1: Write the failing tests**

Add to `tests/notify.test.ts`:

```ts
it('withMention whitelists exactly the notified user so the ping actually fires', () => {
  // src/index.ts sets allowedMentions: { parse: [] } client-wide. A per-message
  // value REPLACES that default (discord.js MessagePayload#resolveBody), so without
  // this the <@id> is an inert grey chip and nobody is notified.
  const out = withMention('u1', { embeds: [] }) as {
    content?: string; allowedMentions?: { users?: string[]; parse?: string[] };
  };
  expect(out.content).toBe('<@u1>');
  expect(out.allowedMentions).toEqual({ users: ['u1'] });
});

it('withMention does not widen the whitelist when the payload already has content', () => {
  // A role or @everyone in caller-supplied content must stay unpingable.
  const out = withMention('u1', { content: '@everyone <@&999> hello' }) as {
    content?: string; allowedMentions?: { users?: string[] };
  };
  expect(out.content).toBe('<@u1> @everyone <@&999> hello');
  expect(out.allowedMentions).toEqual({ users: ['u1'] });
});

it('withMention preserves a components array', () => {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId('alert:mute:u1').setLabel('x').setStyle(ButtonStyle.Secondary));
  const out = withMention('u1', { embeds: [], components: [row] }) as { components?: unknown[] };
  expect(out.components).toHaveLength(1);
});
```

Add `ActionRowBuilder, ButtonBuilder, ButtonStyle` to the `discord.js` import at the top of that test file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/notify.test.ts`
Expected: FAIL — `allowedMentions` is `undefined`.

- [ ] **Step 3: Widen the type and repair `withMention`**

In `src/core/notify.ts`, replace lines 12 and 20-26:

```ts
import type { Client, AttachmentBuilder, ActionRowBuilder, ButtonBuilder } from 'discord.js';

// What a passive notification can carry. A bare string stays legal, so
// Ctx.notify's `message: string` and every one of its call sites are unaffected.
export type NotifyPayload = string | {
  content?: string;
  embeds?: EmbedBuilder[];
  files?: AttachmentBuilder[];
  components?: ActionRowBuilder<ButtonBuilder>[];
  allowedMentions?: { users?: string[]; roles?: string[]; parse?: Array<'users' | 'roles' | 'everyone'> };
};

// Channel deliveries ping the player; DMs do not (a DM already notifies).
// The allowedMentions whitelist is load-bearing, not decoration: src/index.ts
// sets `allowedMentions: { parse: [] }` client-wide so that /dino rename and
// /park rename cannot echo a user-supplied role mention into public content.
// A per-message value REPLACES that default rather than merging with it
// (discord.js MessagePayload#resolveBody), so naming exactly this one user id
// restores the ping without making anything else pingable. Without it the
// <@id> below renders as an inert grey chip and notifies nobody — which is
// what shipped.
// Always returns an object so callers can read `.content` without re-narrowing.
export function withMention(userId: string, payload: NotifyPayload): NotifyPayload {
  const mention = `<@${userId}>`;
  const allowedMentions = { users: [userId] };
  if (typeof payload === 'string') return { content: `${mention} ${payload}`, allowedMentions };
  return { ...payload, content: payload.content ? `${mention} ${payload.content}` : mention, allowedMentions };
}
```

- [ ] **Step 4: Widen the three local payload types and the world one**

In `src/core/notify.ts`, each of the three handlers declares its payload inline at `:62`, `:76`, `:91`. Change each declaration from:

```ts
      const payload: { embeds: EmbedBuilder[]; files?: AttachmentBuilder[] } = { embeds: [embed] };
```

to:

```ts
      const payload: NotifyPayload & { embeds: EmbedBuilder[] } = { embeds: [embed] };
```

In `src/modules/world/embeds.ts:11`:

```ts
export interface Payload { embeds: EmbedBuilder[]; files?: AttachmentBuilder[]; components?: ActionRowBuilder<ButtonBuilder>[] }
```

adding `ActionRowBuilder, ButtonBuilder` to its `discord.js` type import.

- [ ] **Step 5: Repair the trade-offer ping**

`src/modules/trading/index.ts:126` carries a comment asserting the ping works. Replace the comment and the reply at `:126-130`:

```ts
        // The ping goes in `content` AND in allowedMentions: the client-wide
        // `allowedMentions: { parse: [] }` (src/index.ts) means a bare <@id> in
        // content notifies nobody. A per-message value replaces that default, so
        // whitelisting just the recipient pings them and nothing else.
        await i.reply({ content: `<@${target.id}> ${line}`, embeds: [embed], allowedMentions: { users: [target.id] } });
```

Read the surrounding lines first and preserve whatever the existing reply actually passes — the point is adding `allowedMentions`, not rewriting the payload.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/notify.test.ts tests/notify-handlers.test.ts tests/trading.test.ts tests/world-broadcast.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS. There are **four** hand-rolled `Sender` fakes — `tests/notify.test.ts`, `tests/notify-handlers.test.ts`, `tests/journeys.test.ts`, and `tests/world-broadcast.test.ts` (the repo CLAUDE.md omits the last one). Widening `NotifyPayload` with optional fields breaks none of them, but `typecheck` is the only gate that would tell you otherwise.

- [ ] **Step 8: Commit**

```bash
git add src/core/notify.ts src/modules/world/embeds.ts src/modules/trading/index.ts tests/notify.test.ts
git commit -m "Make channel notifications actually ping, and let payloads carry buttons"
```

---

### Task 3: `/park alerts` and the subcommand dispatch fix

**Files:**
- Modify: `src/modules/park/index.ts:76-89` (builder + dispatch)
- Modify: `src/modules/help/index.ts:23-31` (park topic)
- Test: `tests/park.test.ts`

**Interfaces:**
- Consumes: `schema.users.alertsEnabled` from Task 1.
- Produces: `/park alerts state:on|off`, which sets `users.alertsEnabled`.

**⚠️ Read this before writing code.** `/park` has exactly ONE explicit subcommand branch — `=== 'rename'` at `src/modules/park/index.ts:83` — followed by an unguarded else that **is** the view path (`:90-133`). A deployed-but-unimplemented `alerts` subcommand renders the park dashboard and reports success. The dispatch branch must land in the same commit as the builder option.

- [ ] **Step 1: Write the failing tests**

Add to `tests/park.test.ts`:

```ts
it('/park alerts off then on toggles the per-user flag', async () => {
  const ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'u1');
  const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;

  const off = fakeCommand({ name: 'park', sub: 'alerts', user: 'u1', options: { state: 'off' } });
  await cmd.execute(ctx, off.asChatInput());
  expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(false);
  expect(JSON.stringify(off.replies[0])).toContain('off');

  const on = fakeCommand({ name: 'park', sub: 'alerts', user: 'u1', options: { state: 'on' } });
  await cmd.execute(ctx, on.asChatInput());
  expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(true);
});

it('/park alerts does NOT fall through to the dashboard view path', async () => {
  // /park dispatches on `=== 'rename'` and treats everything else as view. Without an
  // explicit alerts branch this subcommand silently renders the park dashboard and
  // reports success — the failure this test exists to catch.
  const ctx = makeCtx();
  getOrCreateUser(ctx, 'u1', 'u1');
  const cmd = parkModule.commands.find((c) => c.data.name === 'park')!;
  const i = fakeCommand({ name: 'park', sub: 'alerts', user: 'u1', options: { state: 'off' } });
  await cmd.execute(ctx, i.asChatInput());
  expect(i.deferOpts).toHaveLength(0);              // the view path always defers
  expect(JSON.stringify(i.replies)).not.toContain('Park rating');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/park.test.ts -t "alerts"`
Expected: FAIL — `fakeCommand` throws `/park has no subcommand 'alerts'`, because the harness resolves options against the real builder JSON.

- [ ] **Step 3: Add the builder option and the dispatch branch**

In `src/modules/park/index.ts`, add a third subcommand to the `/park` builder after `rename`:

```ts
        .addSubcommand((s) => s.setName('alerts').setDescription('Turn proactive park alerts on or off')
          .addStringOption((o) => o.setName('state').setDescription('On or off').setRequired(true)
            .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }))),
```

Then, in `execute`, immediately after the existing `rename` branch and **before** the `targetUser` lookup:

```ts
        // Explicit branch, not an else-fallthrough: /park has no subcommand dispatch —
        // `rename` is the only named case and everything else IS the view path below.
        // A missing branch here renders the dashboard and reports success.
        if (i.options.getSubcommand() === 'alerts') {
          const on = i.options.getString('state', true) === 'on';
          ctx.db.update(schema.users).set({ alertsEnabled: on })
            .where(eq(schema.users.discordId, i.user.id)).run();
          await i.reply({
            content: on
              ? '🔔 Park alerts are **on** — you will get a DM before a dino escapes and when your park hits its income cap.'
              : '🔕 Park alerts are **off**. Egg, breeding, and expedition notifications are unaffected. Turn them back on with `/park alerts state:on`.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
```

`MessageFlags` and `eq` are already imported in this file.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/park.test.ts -t "alerts"`
Expected: PASS.

- [ ] **Step 5: Update the in-game help topic**

In `src/modules/help/index.ts`, add one line to the `park` topic's `body` array, after the `/park rename` line:

```ts
    '`/park alerts state:on|off` — DM warnings before a dino escapes and when income caps. On by default.',
```

**Do not add an `art` key to the `park` topic.** That topic defers and renders the reader's own park map through `withParkImage`, which *assigns* `payload.files` and would silently drop any `attach()`ed banner.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS. Command counts are unchanged — `tests/contract.test.ts:48-49` and `tests/registry-load.test.ts:9-10` count top-level builders (25) and modules (14), and a `choices` option is exempt from the autocomplete manifest because `contract.test.ts:41` only records options where `o.autocomplete === true`.

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/index.ts src/modules/help/index.ts tests/park.test.ts
git commit -m "Add /park alerts and give /park a real subcommand dispatch"
```

---

### Task 4: The `alerts_sent` record layer

**Files:**
- Create: `src/modules/park/alert-record.ts`
- Test: `tests/alert-record.test.ts`

**Interfaces:**
- Consumes: `schema.alertsSent` from Task 1.
- Produces:
  - `type AlertKind = 'escape' | 'income_cap'`
  - `type EscapeTier = 'heads_up' | 'last_call'`
  - `ESCAPE_TIERS: ReadonlyArray<{ tier: EscapeTier; leadMs: number }>` — most urgent first
  - `alreadySent(ctx, userId, kind, refId, tier, firedForMs): boolean`
  - `recordSent(ctx, userId, kind, refId, tier, firedForMs): void`
  - `recordEscapeSent(ctx, userId, dinoId, tier, firedForMs): void` — applies the tier-collapse rule
  - `pruneAlertRecords(ctx): void`
  - `ALERT_RECORD_TTL_MS: number`

- [ ] **Step 1: Write the failing tests**

Create `tests/alert-record.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import {
  alreadySent, recordSent, recordEscapeSent, pruneAlertRecords,
  ESCAPE_TIERS, ALERT_RECORD_TTL_MS,
} from '../src/modules/park/alert-record.js';

const seed = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();

describe('alert record', () => {
  it('reports not-sent for an unseen key and sent after recording it', () => {
    const ctx = makeCtx(); seed(ctx);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(false);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(true);
  });

  it('reports not-sent when the instant moved, so a changed escapeAt re-alerts once', () => {
    // The whole point of storing firedForMs rather than a bare boolean: feeding moves
    // the escape instant, and a dino still inside its window deserves one fresh warning.
    const ctx = makeCtx(); seed(ctx);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 9000)).toBe(false);
  });

  it('recordSent overwrites rather than throwing on the composite primary key', () => {
    const ctx = makeCtx(); seed(ctx);
    recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 5000);
    expect(() => recordSent(ctx, 'u1', 'escape', 7, 'heads_up', 9000)).not.toThrow();
    const rows = ctx.db.select().from(schema.alertsSent).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].firedForMs).toBe(9000);
  });

  it('tier collapse: firing last_call also marks heads_up for the same instant', () => {
    // A dino that first becomes observable already inside 1h fires last_call now. Without
    // collapse, the wider heads_up window is still satisfied next sweep and its key is
    // still free, so the player gets a second, less urgent warning after the urgent one.
    const ctx = makeCtx(); seed(ctx);
    recordEscapeSent(ctx, 'u1', 7, 'last_call', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'last_call', 5000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(true);
  });

  it('tier collapse never runs backwards: firing heads_up leaves last_call free', () => {
    const ctx = makeCtx(); seed(ctx);
    recordEscapeSent(ctx, 'u1', 7, 'heads_up', 5000);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'heads_up', 5000)).toBe(true);
    expect(alreadySent(ctx, 'u1', 'escape', 7, 'last_call', 5000)).toBe(false);
  });

  it('ESCAPE_TIERS is ordered most urgent first', () => {
    // alert-detect picks the FIRST matching tier; a reordered list would classify every
    // dino as heads_up and the last call would never fire.
    expect(ESCAPE_TIERS.map((t) => t.tier)).toEqual(['last_call', 'heads_up']);
    expect(ESCAPE_TIERS[0].leadMs).toBeLessThan(ESCAPE_TIERS[1].leadMs);
  });

  it('prune deletes records older than the TTL and keeps newer ones', () => {
    const ctx = makeCtx({ nowMs: 10 * ALERT_RECORD_TTL_MS }); seed(ctx);
    ctx.db.insert(schema.alertsSent).values([
      { userId: 'u1', kind: 'escape', refId: 1, tier: 'heads_up', firedForMs: 0, sentAt: 0 },
      { userId: 'u1', kind: 'escape', refId: 2, tier: 'heads_up', firedForMs: 0, sentAt: ctx.now() },
    ]).run();
    pruneAlertRecords(ctx);
    const left = ctx.db.select().from(schema.alertsSent).all();
    expect(left.map((r) => r.refId)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/alert-record.test.ts`
Expected: FAIL — cannot resolve `../src/modules/park/alert-record.js`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/park/alert-record.ts`:

```ts
import { and, eq, lt } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import type { Ctx } from '../../core/context.js';
import { ESCAPE_WARN_MS } from '../../core/clock.js';

export type AlertKind = 'escape' | 'income_cap';
export type EscapeTier = 'heads_up' | 'last_call';

/** Last call lead. Deliberately separate from ESCAPE_WARN_MS, which is reused as the
 *  heads-up lead so the DM lands at exactly the instant /park view starts badging. */
export const ESCAPE_LAST_CALL_MS = 3_600_000;

/** MOST URGENT FIRST. alert-detect picks the first tier whose lead the dino is inside,
 *  and recordEscapeSent collapses every LESS urgent tier behind it. Reversing this list
 *  classifies every dino as heads_up and the last call never fires. */
export const ESCAPE_TIERS: ReadonlyArray<{ tier: EscapeTier; leadMs: number }> = [
  { tier: 'last_call', leadMs: ESCAPE_LAST_CALL_MS },
  { tier: 'heads_up', leadMs: ESCAPE_WARN_MS },
];

export const ALERT_RECORD_TTL_MS = 30 * 86_400_000;

/** True when this exact (user, kind, ref, tier) has already fired FOR THIS INSTANT.
 *  Comparing firedForMs rather than mere row existence is what lets a moved instant —
 *  the player fed, reassigned, or spliced — earn exactly one fresh warning. */
export function alreadySent(
  ctx: Ctx, userId: string, kind: AlertKind, refId: number, tier: string, firedForMs: number,
): boolean {
  const row = ctx.db.select().from(schema.alertsSent)
    .where(and(
      eq(schema.alertsSent.userId, userId), eq(schema.alertsSent.kind, kind),
      eq(schema.alertsSent.refId, refId), eq(schema.alertsSent.tier, tier),
    )).get();
  return row !== undefined && row.firedForMs === firedForMs;
}

export function recordSent(
  ctx: Ctx, userId: string, kind: AlertKind, refId: number, tier: string, firedForMs: number,
): void {
  ctx.db.insert(schema.alertsSent)
    .values({ userId, kind, refId, tier, firedForMs, sentAt: ctx.now() })
    .onConflictDoUpdate({
      target: [schema.alertsSent.userId, schema.alertsSent.kind,
               schema.alertsSent.refId, schema.alertsSent.tier],
      set: { firedForMs, sentAt: ctx.now() },
    }).run();
}

/** Record an escape alert AND collapse every less urgent tier for the same instant.
 *  Without the collapse, a dino that first becomes observable already inside the last
 *  call fires it now and then fires the heads-up next sweep: the wider window is still
 *  satisfied and its key is still free. Collapse runs one direction only — firing the
 *  heads-up must leave the last call free, because that is a genuinely later beat. */
export function recordEscapeSent(
  ctx: Ctx, userId: string, dinoId: number, tier: EscapeTier, firedForMs: number,
): void {
  const from = ESCAPE_TIERS.findIndex((t) => t.tier === tier);
  for (const t of ESCAPE_TIERS.slice(from)) {
    recordSent(ctx, userId, 'escape', dinoId, t.tier, firedForMs);
  }
}

/** Bound the table. A pruned row can only re-fire for an instant TTL-old, which the
 *  `escapeAt > now` and `pending > 0` conjuncts in alert-detect already exclude. */
export function pruneAlertRecords(ctx: Ctx): void {
  ctx.db.delete(schema.alertsSent)
    .where(lt(schema.alertsSent.sentAt, ctx.now() - ALERT_RECORD_TTL_MS)).run();
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alert-record.test.ts`
Expected: PASS, all 7.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/alert-record.ts tests/alert-record.test.ts
git commit -m "Add the alert idempotency record with tier collapse"
```

---

### Task 5: The escape predicate

**Files:**
- Create: `src/modules/park/alert-detect.ts`
- Test: `tests/alert-detect.test.ts`

**Interfaces:**
- Consumes: `ESCAPE_TIERS`, `EscapeTier` from Task 4; `escapeAt`, `ClockDino` from `src/core/clock.js`.
- Produces:
  - `interface EscapeAlert { dinoId: number; name: string; escapeAt: number; tier: EscapeTier }`
  - `escapeAlertsFor(clockDinos: ClockDino[], dinos: DinoRow[], now: number): EscapeAlert[]`

This is a pure function: no `Ctx`, no DB, no Discord types. `clockDinos` and `dinos` are index-aligned, exactly as `park/escapes.ts:10-19` and `park/dinos.ts:79-85` already rely on.

- [ ] **Step 1: Write the failing tests**

Create `tests/alert-detect.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { escapeAlertsFor, type DinoLike } from '../src/modules/park/alert-detect.js';
import { escapeAt, ESCAPE_WARN_MS, GRACE_MS, HUNGER_DRAIN_MS } from '../src/core/clock.js';
import { ESCAPE_LAST_CALL_MS } from '../src/modules/park/alert-record.js';
import { getSpecies } from '../src/data/species/index.js';
import { PADDOCKS } from '../src/data/paddocks.js';
import type { ClockDino } from '../src/core/clock.js';

const trike = getSpecies('triceratops');
const herb = PADDOCKS.herbivore_paddock;

const clock = (over: Partial<ClockDino> = {}): ClockDino => ({
  species: trike, paddock: herb, decor: [],
  hungerAtFed: 100, lastFedAt: 0, escapedAt: null, traits: [], ...over,
});
// DinoLike is the narrow row shape the predicate reads — no cast needed, and no DB.
const row = (over: Partial<DinoLike> = {}): DinoLike =>
  ({ id: 1, nickname: null, escapedAt: null, ...over });

describe('escapeAlertsFor', () => {
  it('fires heads_up exactly at the ESCAPE_WARN_MS boundary and not one ms earlier', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_WARN_MS)).toHaveLength(1);
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_WARN_MS - 1)).toHaveLength(0);
  });

  it('classifies as last_call once inside the shorter lead', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_WARN_MS)[0].tier).toBe('heads_up');
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_LAST_CALL_MS)[0].tier).toBe('last_call');
  });

  it('never fires for an already-escaped dino', () => {
    const c = clock({ escapedAt: 5 });
    expect(escapeAlertsFor([c], [row({ escapedAt: 5 })], 10)).toHaveLength(0);
  });

  it('never fires for an unassigned dino', () => {
    // escapeAt returns null with no paddock: an unassigned dino cannot escape.
    const c = clock({ paddock: null });
    expect(escapeAt(c)).toBeNull();
    expect(escapeAlertsFor([c], [row()], 0)).toHaveLength(0);
  });

  it('suppresses a dino whose escape instant has already passed', () => {
    // The downtime guard. After an outage the sweep must not warn about a dino that
    // already bolted but whose row was never stamped by settleEscapes.
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc)).toHaveLength(0);
    expect(escapeAlertsFor([c], [row()], esc + 1_000_000)).toHaveLength(0);
  });

  it('prefers the nickname and falls back to the species name', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    const at = esc - ESCAPE_LAST_CALL_MS;
    expect(escapeAlertsFor([c], [row()], at)[0].name).toBe('Triceratops');
    expect(escapeAlertsFor([c], [row({ nickname: 'Rexy' })], at)[0].name).toBe('Rexy');
  });

  it('returns the soonest escape first', () => {
    const soon = clock();
    const later = clock({ lastFedAt: 6 * 3_600_000 });
    const escSoon = escapeAt(soon)!;
    const out = escapeAlertsFor([later, soon], [row({ id: 2 }), row({ id: 1 })],
                                escSoon - ESCAPE_LAST_CALL_MS);
    expect(out[0].dinoId).toBe(1);
    expect(out[0].escapeAt).toBeLessThan(out[1].escapeAt);
  });

  it('reports the raw escape instant, so the record layer keys on a stable value', () => {
    const c = clock();
    const esc = escapeAt(c)!;
    expect(escapeAlertsFor([c], [row()], esc - ESCAPE_LAST_CALL_MS)[0].escapeAt).toBe(esc);
    // Sanity: the fixture's instant is drain + grace, i.e. the clock module's own math.
    expect(esc).toBe(HUNGER_DRAIN_MS * 0.75 + GRACE_MS);
  });
});
```

If the final assertion's arithmetic does not match, **do not change the assertion to fit** — read `comfortCrossing` in `src/core/clock.ts:61-67` and compute the true value for a Triceratops in a herbivore paddock with no decor. A fixture bent to match the implementation tests nothing.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/alert-detect.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/modules/park/alert-detect.ts`:

```ts
import { escapeAt, type ClockDino } from '../../core/clock.js';
import { ESCAPE_TIERS, type EscapeTier } from './alert-record.js';

export interface EscapeAlert { dinoId: number; name: string; escapeAt: number; tier: EscapeTier }

/** Rows this predicate reads. Deliberately narrower than the full dinos row so the
 *  function stays pure and its tests need no DB. Exported for those tests. */
export interface DinoLike { id: number; nickname: string | null; escapedAt: number | null }

/**
 * Dinos that are inside an escape-warning lead as of `now`.
 *
 * `clockDinos` and `dinos` are INDEX-ALIGNED, the same contract park/escapes.ts and
 * park/dinos.ts already rely on — never zip them by id.
 *
 * Three conjuncts, each load-bearing:
 *   - `escapedAt === null`  — the row has already been stamped; nothing to warn about.
 *   - `esc !== null`        — escapeAt returns null without a paddock; unassigned dinos
 *                             never escape.
 *   - `esc > now`           — the downtime guard. After an outage an unstamped dino can
 *                             still yield an instant in the past; warning about it would
 *                             be a lie.
 */
export function escapeAlertsFor(clockDinos: ClockDino[], dinos: DinoLike[], now: number): EscapeAlert[] {
  const out: EscapeAlert[] = [];
  for (let idx = 0; idx < dinos.length; idx++) {
    const row = dinos[idx];
    if (row.escapedAt !== null) continue;
    const esc = escapeAt(clockDinos[idx]);
    if (esc === null || esc <= now) continue;
    const remaining = esc - now;
    // ESCAPE_TIERS is most-urgent-first, so the first match is the most urgent tier
    // this dino qualifies for. recordEscapeSent then collapses the less urgent ones.
    const tier = ESCAPE_TIERS.find((t) => remaining <= t.leadMs);
    if (!tier) continue;
    out.push({
      dinoId: row.id,
      name: row.nickname ?? clockDinos[idx].species.name,
      escapeAt: esc,
      tier: tier.tier,
    });
  }
  return out.sort((a, b) => a.escapeAt - b.escapeAt);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alert-detect.test.ts`
Expected: PASS, all 8.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/alert-detect.ts tests/alert-detect.test.ts
git commit -m "Add the escape-warning predicate"
```

---

### Task 6: The income-cap predicate

**Files:**
- Modify: `src/modules/park/alert-detect.ts`
- Test: `tests/alert-detect.test.ts`

**Interfaces:**
- Consumes: `accruedIncome` from `src/core/clock.js`; `capHours`, `facilityBonusPct` from `src/modules/park/service.js`.
- Produces:
  - `interface IncomeCapAlert { capAt: number; pending: number; capHours: number }`
  - `incomeCapAlertFor(clockDinos, lots, lastCollectAt, now): IncomeCapAlert | null`

**Three facts this must respect** (all verified against source; do not "simplify" them away):
- `capAt` is an **upper bound** on when earning stops, not the instant — `accruedIncome` clamps each dino independently at its own `escapeAt` and `hungerZero` (`clock.ts:96-99`). The copy must never claim a precise instant.
- `collectIncome` writes `lastCollectAt` only when `amount > 0` (`park/service.ts:150-156`), so `capAt` is not "time since you pressed Collect".
- `pending > 0` is **not monotone**: `accruedIncome` recomputes the whole window from *current* hunger, so a starved park reading 0 jumps to a full payout the moment its owner feeds. Level triggering absorbs this — the alert simply fires on the sweep where it first becomes true.

- [ ] **Step 1: Write the failing tests**

Append to `tests/alert-detect.test.ts`:

```ts
import { incomeCapAlertFor } from '../src/modules/park/alert-detect.js';
import type { Lot } from '../src/modules/park/service.js';

// capHours and facilityBonusPct read only `kind` and `level`, so a partial row cast to
// Lot is honest here — building real rows would drag a DB into a pure-function test.
const lot = (over: Partial<Lot> = {}) =>
  ({ id: 1, userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'p',
     level: 1, decor: [], ...over }) as unknown as Lot;

describe('incomeCapAlertFor', () => {
  it('is null before the cap instant and non-null at or after it', () => {
    const c = clock();
    const CAP = 8 * 3_600_000;                       // no visitor center → capHours 8
    expect(incomeCapAlertFor([c], [lot()], 0, CAP - 1)).toBeNull();
    const hit = incomeCapAlertFor([c], [lot()], 0, CAP);
    expect(hit).not.toBeNull();
    expect(hit!.capAt).toBe(CAP);
    expect(hit!.capHours).toBe(8);
    expect(hit!.pending).toBeGreaterThan(0);
  });

  it('is null when nothing is pending, even past the cap', () => {
    // An empty park, or one whose dinos are all unassigned, must not be nagged.
    expect(incomeCapAlertFor([], [lot()], 0, 100 * 3_600_000)).toBeNull();
    const unassigned = clock({ paddock: null });
    expect(incomeCapAlertFor([unassigned], [lot()], 0, 100 * 3_600_000)).toBeNull();
  });

  it('uses the Visitor Center cap when one is built above level 1', () => {
    // Level 1 is capHours[0] = 8, identical to no facility at all — only L2+ widens it.
    const c = clock();
    const vc1 = [lot(), lot({ id: 2, type: 'facility', kind: 'visitor_center', level: 1 })];
    const vc2 = [lot(), lot({ id: 2, type: 'facility', kind: 'visitor_center', level: 2 })];
    expect(incomeCapAlertFor([c], vc1, 0, 8 * 3_600_000)!.capHours).toBe(8);
    expect(incomeCapAlertFor([c], vc2, 0, 8 * 3_600_000)).toBeNull();
    expect(incomeCapAlertFor([c], vc2, 0, 12 * 3_600_000)!.capHours).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/alert-detect.test.ts -t "incomeCapAlertFor"`
Expected: FAIL — `incomeCapAlertFor` is not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/modules/park/alert-detect.ts`:

```ts
import { accruedIncome } from '../../core/clock.js';
import { capHours, facilityBonusPct, type Lot } from './service.js';

export interface IncomeCapAlert { capAt: number; pending: number; capHours: number }

/**
 * The park has stopped earning and has money waiting.
 *
 * `capAt` is an UPPER BOUND, not the instant earning stopped: accruedIncome clamps each
 * dino independently at its own escapeAt and hungerZero (clock.ts:96-99), so a starving
 * park stops earlier. The embed must therefore never quote a precise instant — only that
 * the cap has been reached.
 *
 * `pending > 0` is NOT monotone: accruedIncome recomputes the whole window from CURRENT
 * hunger, so a starved park reading 0 jumps to a full capped payout the moment its owner
 * feeds. That is exactly why this is level-triggered — the alert fires on the sweep where
 * the condition first becomes true, rather than being missed forever by an edge test.
 */
export function incomeCapAlertFor(
  clockDinos: ClockDino[], lots: Lot[], lastCollectAt: number, now: number,
): IncomeCapAlert | null {
  const hours = capHours(lots);
  const capAt = lastCollectAt + hours * 3_600_000;
  if (now < capAt) return null;
  const pending = accruedIncome(clockDinos, facilityBonusPct(lots), hours, lastCollectAt, now);
  if (pending <= 0) return null;
  return { capAt, pending, capHours: hours };
}
```

`Lot` is exported from `src/modules/park/service.ts:21` as `typeof schema.lots.$inferSelect` — import it from there, not from the schema module.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alert-detect.test.ts`
Expected: PASS, all 11.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/alert-detect.ts tests/alert-detect.test.ts
git commit -m "Add the income-cap predicate"
```

---

### Task 7: The combined alert payload

**Files:**
- Create: `src/modules/park/alert-embeds.ts`
- Test: `tests/alert-embeds.test.ts`

**Interfaces:**
- Consumes: `EscapeAlert`, `IncomeCapAlert` from Tasks 5-6.
- Produces: `alertPayload(userId: string, escapes: EscapeAlert[], income: IncomeCapAlert | null, now: number): NotifyPayload & { embeds: EmbedBuilder[] }`

**Hard rules for this payload:** it reaches `deliverNotification`, which forwards ONE object to two send sites. It must therefore carry **no `attachments` key at all**. Build it fresh per user inside the sweep loop — never once outside it.

- [ ] **Step 1: Write the failing tests**

Create `tests/alert-embeds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { alertPayload } from '../src/modules/park/alert-embeds.js';
import { validateMessagePayload } from './lib/discord-limits.js';

const esc = (over = {}) => ({ dinoId: 1, name: 'Rexy', escapeAt: 3_600_000, tier: 'last_call' as const, ...over });
const json = (p: ReturnType<typeof alertPayload>) => p.embeds[0].toJSON();

describe('alertPayload', () => {
  it('renders both conditions in one embed with one button row', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, 0);
    const d = json(p).description ?? '';
    expect(d).toContain('Rexy');
    expect(d).toContain('1,240');
    expect(p.components).toHaveLength(1);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Feed all button when there are no escapes', () => {
    const p = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, 0);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Collect button when income has not capped', () => {
    const p = alertPayload('u1', [esc()], null, 0);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:mute:u1']);
  });

  it('carries NO attachments key — deliverNotification forwards one object to two sends', () => {
    // MessagePayload.resolveBody PUSHES into an explicit attachments array and create()
    // only shallow-copies it, so a shared array accumulates duplicate ids on the second
    // send. Notification payloads are safe precisely because they omit the key.
    const p = alertPayload('u1', [esc()], null, 0) as Record<string, unknown>;
    expect('attachments' in p).toBe(false);
  });

  it('truncates a large roster and says how many were hidden', () => {
    // Ceiling is 10 lots x paddockCapacity(4)=8 = 80 dinos, well past the 4096-char
    // description limit.
    const many = Array.from({ length: 80 }, (_, n) =>
      esc({ dinoId: n + 1, name: `Dino${n}`, escapeAt: (n + 1) * 60_000 }));
    const p = alertPayload('u1', many, null, 0);
    expect(json(p).description).toContain('+75 more');
    validateMessagePayload(p, 'alert payload');       // throws if any Discord limit is blown
  });

  it('passes Discord limit validation in the everyday case', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, 0);
    expect(() => validateMessagePayload(p, 'alert payload')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/alert-embeds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/modules/park/alert-embeds.ts`:

```ts
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { assetImage, attach } from '../../core/images.js';
import type { NotifyPayload } from '../../core/notify.js';
import type { EscapeAlert, IncomeCapAlert } from './alert-detect.js';

const MAX_LISTED = 5;

function fmtRemaining(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `~${mins}m`;
  return `~${Math.round(mins / 60)}h`;
}

/**
 * One combined alert for one player.
 *
 * MUST be built fresh per user inside the sweep's fan-out, never once outside it: this
 * object reaches deliverNotification, which hands the SAME object to channelSend and
 * then dmSend. For the same reason it carries no `attachments` key — MessagePayload
 * pushes into an explicit array in place and only shallow-copies it.
 */
export function alertPayload(
  userId: string, escapes: EscapeAlert[], income: IncomeCapAlert | null, now: number,
): NotifyPayload & { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  const lines: string[] = [];

  if (escapes.length > 0) {
    const shown = escapes.slice(0, MAX_LISTED)
      .map((e) => `**${e.name}** escapes in ${fmtRemaining(e.escapeAt - now)}`)
      .join(' · ');
    const hidden = escapes.length - MAX_LISTED;
    lines.push(`**🦖 Unsettled dinos** — ${shown}${hidden > 0 ? ` · **+${hidden} more**` : ''}`);
  }
  if (income) {
    // Never quote a precise "stopped earning at" instant: capAt is an upper bound, and a
    // starving park stops earlier (accruedIncome clamps per dino at escapeAt/hungerZero).
    lines.push(`**💰 Income capped** — **${income.pending.toLocaleString('en-US')}** cash pending at your ${income.capHours}-hour cap, no longer growing`);
  }

  const embed = new EmbedBuilder().setColor(0xe67e22)
    .setTitle('🚨 Your park needs you')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Turn these off any time with /park alerts state:off' });

  const payload: NotifyPayload & {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[];
  } = { embeds: [embed], components: [] };

  // Domain-data ternary, deliberately OUTSIDE attach(): a park with no escapes is not
  // a missing asset, it is a different banner.
  attach(embed, payload, 'image',
    assetImage('banners', escapes.length > 0 ? 'care_neglect' : 'collect'));

  const row = new ActionRowBuilder<ButtonBuilder>();
  if (escapes.length > 0) {
    row.addComponents(new ButtonBuilder().setCustomId(`alert:feedall:${userId}`)
      .setLabel('🍖 Feed all').setStyle(ButtonStyle.Primary));
  }
  if (income) {
    row.addComponents(new ButtonBuilder().setCustomId(`alert:collect:${userId}`)
      .setLabel('💰 Collect').setStyle(ButtonStyle.Success));
  }
  row.addComponents(new ButtonBuilder().setCustomId(`alert:mute:${userId}`)
    .setLabel('🔕 Mute alerts').setStyle(ButtonStyle.Secondary));
  payload.components.push(row);

  return payload;
}
```

Note the labels use unicode emoji, not `emojiTag`/`rarityEmoji`. `setEmoji` is never called — a rarity tag passed to it throws rather than degrading.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alert-embeds.test.ts`
Expected: PASS, all 6.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/modules/park/alert-embeds.ts tests/alert-embeds.test.ts
git commit -m "Add the combined park alert payload"
```

---

### Task 8: The sweep timer

**Files:**
- Create: `src/modules/park/alert-sweep.ts`
- Modify: `src/index.ts:35-38` (register), `:49` (arm)
- Test: `tests/alert-sweep.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 4-7; `Sender` and `deliverNotification` from `src/core/notify.js`; `toClockDinos` from `./service.js`.
- Produces:
  - `ALERT_TIMER = 'alert_sweep'`, `SWEEP_MS = 900_000`
  - `armAlertSweep(ctx: Ctx): void`
  - `alertSweepHandler(sender: Sender, ctx: Ctx): (t: Timer) => Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `tests/alert-sweep.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { makeCtx } from './harness.js';
import { schema } from '../src/core/db/index.js';
import type { NotifyPayload, Sender } from '../src/core/notify.js';
import { armAlertSweep, alertSweepHandler, ALERT_TIMER, SWEEP_MS } from '../src/modules/park/alert-sweep.js';
import { ESCAPE_WARN_MS, GRACE_MS, HUNGER_DRAIN_MS } from '../src/core/clock.js';

function capture() {
  const dms: Array<{ userId: string; payload: NotifyPayload }> = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('alerts are DM-only'); },
    dmSend: async (userId, payload) => { dms.push({ userId, payload }); },
  };
  return { dms, sender };
}

// A Triceratops in a herbivore paddock fed at t=0 escapes at drain*0.75 + grace.
const ESCAPE_AT = HUNGER_DRAIN_MS * 0.75 + GRACE_MS;

function seedAtRiskPlayer(ctx: ReturnType<typeof makeCtx>, id = 'u1') {
  ctx.db.insert(schema.users).values({ discordId: id, lastCollectAt: 0, createdAt: 0 }).run();
  const lot = ctx.db.insert(schema.lots)
    .values({ userId: id, type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).returning().get();
  ctx.db.insert(schema.dinos).values({
    userId: id, lotId: lot.id, speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0,
  }).run();
}

// id 999, deliberately: the handler's re-arm excludes its OWN row by id, and the rows it
// inserts start at 1. A fake id of 1 would collide with the first inserted row, making the
// re-arm exclude the real successor and enqueue a second one — the test would then assert
// the bug rather than the fix.
const timer = (firesAt: number) =>
  ({ id: 999, kind: ALERT_TIMER, userId: '0', refId: 0, originGuildId: null, firesAt, handledAt: null });

describe('alert sweep', () => {
  it('arms one timer and is idempotent on a second call', () => {
    const ctx = makeCtx();
    armAlertSweep(ctx); armAlertSweep(ctx);
    const rows = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe('0');         // sentinel: adminReset/fastForward filter by userId
    expect(rows[0].firesAt).toBe(ctx.now() + SWEEP_MS);
  });

  it('DMs an at-risk player exactly once, then stays quiet on the next sweep', async () => {
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    const { dms, sender } = capture();
    const handler = alertSweepHandler(sender, ctx);
    await handler(timer(ctx.now()));
    expect(dms).toHaveLength(1);
    expect(dms[0].userId).toBe('u1');
    ctx.setNow(ctx.now() + SWEEP_MS);
    await handler(timer(ctx.now()));
    expect(dms).toHaveLength(1);              // idempotent: same escapeAt, already recorded
  });

  it('re-running the SAME timer row does not double-alert', async () => {
    // setInterval does not await the in-flight tick (src/index.ts:40) and `attempted` is
    // consulted only in the due-snapshot filter, so one row genuinely can run twice.
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    const { dms, sender } = capture();
    const handler = alertSweepHandler(sender, ctx);
    await handler(timer(ctx.now()));
    await handler(timer(ctx.now()));
    expect(dms).toHaveLength(1);
  });

  it('never DMs a muted player', async () => {
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    ctx.db.update(schema.users).set({ alertsEnabled: false })
      .where(eq(schema.users.discordId, 'u1')).run();
    const { dms, sender } = capture();
    await alertSweepHandler(sender, ctx)(timer(ctx.now()));
    expect(dms).toHaveLength(0);
  });

  it('re-arms exactly once, and only when no other pending row exists', async () => {
    const ctx = makeCtx();
    const { sender } = capture();
    await alertSweepHandler(sender, ctx)(timer(ctx.now()));
    let pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(pending).toHaveLength(1);
    expect(pending[0].firesAt).toBe(ctx.now() + SWEEP_MS);
    // A duplicate pending row must make the next re-arm a no-op, so the pair converges
    // back to one instead of doubling every sweep (2^n).
    await alertSweepHandler(sender, ctx)(timer(ctx.now()));
    pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(pending).toHaveLength(1);
  });

  it('one player with a broken species id does not stop the others', async () => {
    // getSpecies throws on an unknown id and toClockDinos calls it per dino, so without
    // the per-user catch a single bad row kills alerts for the whole process.
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    ctx.db.insert(schema.users).values({ discordId: 'bad', lastCollectAt: 0, createdAt: 0 }).run();
    const badLot = ctx.db.insert(schema.lots)
      .values({ userId: 'bad', type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).returning().get();
    ctx.db.insert(schema.dinos).values({
      userId: 'bad', lotId: badLot.id, speciesId: 'not_a_species', hunger: 100, lastFedAt: 0, hatchedAt: 0,
    }).run();
    seedAtRiskPlayer(ctx, 'u2');
    const { dms, sender } = capture();
    await expect(alertSweepHandler(sender, ctx)(timer(ctx.now()))).resolves.toBeUndefined();
    expect(dms.map((d) => d.userId)).toEqual(['u2']);
  });

  it('re-arms even when every DM throws', async () => {
    const ctx = makeCtx({ nowMs: ESCAPE_AT - ESCAPE_WARN_MS });
    seedAtRiskPlayer(ctx);
    const sender: Sender = {
      channelSend: async () => { throw new Error('nope'); },
      dmSend: async () => { throw new Error('blocked'); },
    };
    await expect(alertSweepHandler(sender, ctx)(timer(ctx.now()))).resolves.toBeUndefined();
    const pending = ctx.db.select().from(schema.timers)
      .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
    expect(pending).toHaveLength(1);
  });
});
```

Every test body that calls the handler must be `async` — the handler returns a promise and an un-awaited call would let the assertion run before any DM is captured.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/alert-sweep.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/modules/park/alert-sweep.ts`:

```ts
import { and, eq, isNull, ne } from 'drizzle-orm';
import { schema } from '../../core/db/index.js';
import { logger } from '../../core/logger.js';
import type { Ctx } from '../../core/context.js';
import type { Timer } from '../../core/scheduler.js';
import { type Sender, deliverNotification } from '../../core/notify.js';
import { toClockDinos } from './service.js';
import { escapeAlertsFor, incomeCapAlertFor } from './alert-detect.js';
import { alreadySent, recordSent, recordEscapeSent, pruneAlertRecords } from './alert-record.js';
import { alertPayload } from './alert-embeds.js';

export const ALERT_TIMER = 'alert_sweep';
export const SWEEP_MS = 15 * 60_000;

// Not per-user, but Scheduler.enqueue requires a userId. '0' can never collide with a
// real Discord snowflake, which matters because adminReset deletes timers BY userId and
// adminFastForward shifts them BY userId (src/modules/admin/service.ts) — a colliding
// sentinel would let one player's reset kill alerts for every server.
const SENTINEL_USER = '0';

/** Seed the first timer. Idempotent: `timers` has NO unique index, so an unguarded
 *  boot-time enqueue accumulates duplicate rows and, with them, duplicate sweeps. */
export function armAlertSweep(ctx: Ctx): void {
  const pending = ctx.db.select().from(schema.timers)
    .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt))).all();
  if (pending.length > 0) return;
  ctx.db.insert(schema.timers).values({
    kind: ALERT_TIMER, userId: SENTINEL_USER, refId: 0,
    originGuildId: null, firesAt: ctx.now() + SWEEP_MS,
  }).run();
}

export function alertSweepHandler(sender: Sender, ctx: Ctx) {
  return async (t: Timer): Promise<void> => {
    // ONE clock read for the whole sweep: every predicate and the re-arm must agree on
    // "now", or a slow fan-out would classify late users against a different instant.
    const now = ctx.now();

    // No window, no anchor arithmetic. The sweep asks "does the condition hold NOW, and
    // have I already sent for THIS instant?" — which is why a late fire, a re-run of the
    // same row, or a multi-day outage cannot produce a duplicate or a miss.
    const targets = ctx.db.select().from(schema.users)
      .where(eq(schema.users.alertsEnabled, true)).all();

    for (const u of targets) {
      // Individually caught, like world/broadcast.ts's fan-out: Scheduler.tick writes
      // handledAt only after the handler RESOLVES and parks a thrower in `attempted` for
      // the life of the process, so one bad user would otherwise abort the sweep AND
      // block the re-arm below. getSpecies throws on an unknown species id and
      // toClockDinos calls it per dino — that is the realistic thrower.
      try {
        const { clockDinos, lots, user, dinos } = toClockDinos(ctx, u.discordId);
        if (lots.length === 0) continue;

        const escapes = escapeAlertsFor(clockDinos, dinos, now)
          .filter((e) => !alreadySent(ctx, u.discordId, 'escape', e.dinoId, e.tier, e.escapeAt));

        const cap = incomeCapAlertFor(clockDinos, lots, user.lastCollectAt, now);
        const income = cap && !alreadySent(ctx, u.discordId, 'income_cap', 0, '', cap.capAt)
          ? cap : null;

        if (escapes.length === 0 && !income) continue;

        // A FRESH payload per user. deliverNotification forwards ONE object to two send
        // sites (channel then DM), so a shared object is the finalPayload() hazard from
        // fightFrames. Building inside the loop also keeps `attachments` absent.
        const payload = alertPayload(u.discordId, escapes, income, now);

        // originGuildId null → deliverNotification skips the channel branch entirely and
        // DMs. Deliberate: a sweep has no originating interaction, and guessing a guild
        // from user_guilds routes into channels the player may no longer be able to see.
        await deliverNotification(sender, ctx, u.discordId, null, payload);

        // Recorded only AFTER the send resolves. deliverNotification never throws, so this
        // always runs — but keeping the order means a future throwing sender leaves the
        // alert owed rather than silently consumed.
        for (const e of escapes) recordEscapeSent(ctx, u.discordId, e.dinoId, e.tier, e.escapeAt);
        if (income) recordSent(ctx, u.discordId, 'income_cap', 0, '', income.capAt);
      } catch (err) {
        logger.warn({ err, userId: u.discordId }, 'alert sweep failed for user');
      }
    }

    // Both of these are in their own try: world/broadcast.ts leaves its re-arm unguarded,
    // and here that is the difference between "one late sweep" and "alerts are dead until
    // the process restarts" — scheduler.ts parks a throwing handler in `attempted` behind
    // a single logger.error and never retries it this process.
    try { pruneAlertRecords(ctx); }
    catch (err) { logger.warn({ err }, 'alert record prune failed'); }

    try {
      // Re-arm LAST and unconditionally, but excluding this timer's own row. Without the
      // exclusion two processes racing the same due row both re-arm, leaving 2 pending;
      // next sweep each re-arms again, and growth is 2^n. With it, a duplicate pair
      // converges back to one on the next fire.
      const others = ctx.db.select().from(schema.timers)
        .where(and(eq(schema.timers.kind, ALERT_TIMER), isNull(schema.timers.handledAt),
                   ne(schema.timers.id, t.id))).all();
      if (others.length === 0) {
        ctx.db.insert(schema.timers).values({
          kind: ALERT_TIMER, userId: SENTINEL_USER, refId: 0,
          originGuildId: null, firesAt: now + SWEEP_MS,
        }).run();
      }
    } catch (err) { logger.error({ err }, 'alert sweep re-arm failed'); }
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alert-sweep.test.ts`
Expected: PASS, all 7.

- [ ] **Step 5: Wire it into the bot**

In `src/index.ts`, add one registration beside the other four (after line 38, **before** the `setInterval` at `:40`):

```ts
scheduler.register(ALERT_TIMER, alertSweepHandler(sender, ctx));
```

and one arm call inside `ClientReady`, next to `armWorldBroadcast(ctx)` at `:49` and **before** the boot-scan tick at `:50`:

```ts
  armAlertSweep(ctx);
```

with the import:

```ts
import { ALERT_TIMER, armAlertSweep, alertSweepHandler } from './modules/park/alert-sweep.js';
```

Registering after the `setInterval` would leave the kind unregistered for the first tick — and an unregistered kind hits `scheduler.ts:30`'s bare `continue` after already being added to `attempted`, dying **with no log line at all**.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/alert-sweep.ts src/index.ts tests/alert-sweep.test.ts
git commit -m "Add the proactive alert sweep"
```

---

### Task 9: The `alert` button handlers

**Files:**
- Modify: `src/modules/park/index.ts` (append to `components`)
- Test: `tests/alert-buttons.test.ts`

**Interfaces:**
- Consumes: `feedAll` from `../care/service.js`; `collectIncome`, `settleEscapes` from this module.
- Produces: component prefix `alert`, actions `feedall` / `collect` / `mute`.

**⚠️ Append, never prepend.** `tests/dinos.test.ts:140,149,196,201,207` index `parkModule.components[0]`. The new entry goes after the existing `park` one.

- [ ] **Step 1: Write the failing tests**

Create `tests/alert-buttons.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ButtonInteraction } from 'discord.js';
import { makeCtx, fakeButton } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { parkModule } from '../src/modules/park/index.js';

const alertComp = () => parkModule.components.find((c) => c.prefix === 'alert')!;
const seed = (ctx: ReturnType<typeof makeCtx>) =>
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();

describe('alert buttons', () => {
  it('is registered AFTER the park prefix so components[0] stays park', () => {
    expect(parkModule.components[0].prefix).toBe('park');
    expect(parkModule.components.map((c) => c.prefix)).toContain('alert');
  });

  it('rejects a bystander with an ephemeral reply and changes nothing', async () => {
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:mute:u1', user: 'someone_else' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0])).toContain('not your park');
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(true);
  });

  it('mute sets the flag off and updates the alert in place', async () => {
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:mute:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(false);
    const p = b.replies[0] as { components?: unknown[]; attachments?: unknown[] };
    expect(p.components).toEqual([]);                 // buttons are consumed
    expect(p.attachments).toEqual([]);                // the alert carried a banner file
  });

  it('collect on an empty park reports nothing to collect rather than throwing', async () => {
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:collect:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0]).toLowerCase()).toContain('nothing to collect');
  });

  it('feed all with no food reports it instead of throwing', async () => {
    const ctx = makeCtx(); seed(ctx);
    const lot = ctx.db.insert(schema.lots)
      .values({ userId: 'u1', type: 'paddock', kind: 'herbivore_paddock', name: 'p' }).returning().get();
    ctx.db.insert(schema.dinos).values({
      userId: 'u1', lotId: lot.id, speciesId: 'triceratops', hunger: 10, lastFedAt: 0, hatchedAt: 0,
    }).run();
    const b = fakeButton({ customId: 'alert:feedall:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(JSON.stringify(b.replies[0]).toLowerCase()).toMatch(/food|fed 0|nothing/);
  });

  it('an unknown action defers instead of leaving the interaction unacknowledged', async () => {
    // Seven of the ten live prefixes have no fallback; an unhandled click shows the user
    // "This interaction failed". daily/ach are the precedent: deferUpdate, before the
    // owner check, so a stale customId from an older deploy is silently absorbed.
    const ctx = makeCtx(); seed(ctx);
    const b = fakeButton({ customId: 'alert:whatever:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    expect(b.deferOpts.length + b.replies.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/alert-buttons.test.ts`
Expected: FAIL — no component with prefix `alert`.

- [ ] **Step 3: Write the handler**

In `src/modules/park/index.ts`, append a second entry to the `components` array, after the existing `{ prefix: 'park', ... }` object:

```ts
    {
      prefix: 'alert',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        // deferUpdate BEFORE the owner check, copying daily/ach: a customId shape from an
        // older deploy must be absorbed rather than shown as "This interaction failed".
        if (action !== 'feedall' && action !== 'collect' && action !== 'mute') {
          await i.deferUpdate();
          return;
        }
        // Every alert button acts on the ALERTED user, so ownership is checked here — the
        // park:assignyes pattern, not the self-serve park:collect one.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (action === 'mute') {
          ctx.db.update(schema.users).set({ alertsEnabled: false })
            .where(eq(schema.users.discordId, i.user.id)).run();
          // attachments: [] sheds the alert's banner upload — this update carries no files.
          await i.update({
            content: '🔕 Park alerts muted. Turn them back on with `/park alerts state:on`.',
            embeds: [], components: [], attachments: [],
          });
          return;
        }
        if (action === 'collect') {
          settleEscapes(ctx, i.user.id);
          const { amount } = collectIncome(ctx, i.user.id);
          await i.update({
            content: amount > 0
              ? `💰 Collected **${amount.toLocaleString('en-US')}** cash.`
              : 'Nothing to collect yet — give your dinos time to earn.',
            embeds: [], components: [], attachments: [],
          });
          return;
        }
        // feedall
        settleEscapes(ctx, i.user.id);
        const { fed, skipped } = feedAll(ctx, i.user.id);
        const line = fed.length === 0
          ? (skipped.length > 0
              ? '🍖 No matching food — buy some with `/shop food`.'
              : '🍖 Nothing to feed — every dino is already full.')
          : `🍖 Fed **${fed.length}** ${fed.length === 1 ? 'dino' : 'dinos'}${skipped.length ? ` — ${skipped.length} skipped for lack of matching food.` : '.'}`;
        await i.update({ content: line, embeds: [], components: [], attachments: [] });
      },
    },
```

Add `feedAll` to the imports:

```ts
import { feedAll } from '../care/service.js';
```

`collectIncome`, `settleEscapes`, `schema`, `eq`, and `MessageFlags` are already imported in this file. This is a leaf import — `care/service.ts` already imports from `park/service.ts` and `park/rating.ts`, and `park/service.ts` imports nothing from `care`, so no cycle is created.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/alert-buttons.test.ts tests/dinos.test.ts`
Expected: PASS. `dinos.test.ts` is included because it indexes `parkModule.components[0]` — if it fails, the new entry was prepended rather than appended.

- [ ] **Step 5: Exempt the prefix from the quest hint**

In `src/modules/daily/hooks.ts:8`:

```ts
// `alert` is exempt for the same reason daily/ach are: an alert is a DM, where an
// "ephemeral" followUp is just a second visible message — and a quest-complete hint
// immediately after clicking Mute is absurd.
const EXEMPT_PREFIXES = new Set(['daily', 'ach', 'alert']);
```

- [ ] **Step 6: Run the full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/modules/park/index.ts src/modules/daily/hooks.ts tests/alert-buttons.test.ts
git commit -m "Add the alert action buttons"
```

---

### Task 10: Buttons on the three completion notifications

**Files:**
- Modify: `src/core/notify.ts:53-95` (all three handlers)
- Modify: `src/modules/expeditions/index.ts` (new `exp` prefix)
- Modify: `src/modules/genelab/index.ts:206-227` (new `claim` action on `breed`)
- Test: `tests/notify-handlers.test.ts`, `tests/alert-buttons.test.ts`

**Interfaces:**
- Consumes: `NotifyPayload.components` from Task 2.
- Produces: `hatch:crack:<eggId>` reused; new `breed:claim:<breedingId>`; new component prefix `exp` with action `claim`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/notify-handlers.test.ts`:

```ts
const customIds = (p: NotifyPayload | undefined) =>
  ((p as { components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }> })?.components ?? [])
    .flatMap((r) => r.toJSON().components.map((c) => c.custom_id));

it('the egg-ready notification carries a Hatch button pointed at the existing handler', async () => {
  const ctx = makeCtx();
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
  const egg = ctx.db.insert(schema.eggs)
    .values({ userId: 'u1', rarity: 'rare', source: 'shop', obtainedAt: 0 }).returning().get();
  const { dms, sender } = capture();
  await eggHatchHandler(sender, ctx)({ userId: 'u1', refId: egg.id, originGuildId: null });
  expect(customIds(dms[0])).toEqual([`hatch:crack:${egg.id}`]);
});

it('the expedition-return notification carries a Claim button', async () => {
  const ctx = makeCtx();
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
  const exp = ctx.db.insert(schema.expeditions).values({
    userId: 'u1', siteId: 'amber_forest', departedAt: 0, returnsAt: 0,
  }).returning().get();
  const { dms, sender } = capture();
  await expeditionReturnHandler(sender, ctx)({ userId: 'u1', refId: exp.id, originGuildId: null });
  expect(customIds(dms[0])).toEqual(['exp:claim:u1']);
});
```

Match the `expeditions` insert columns to the real schema — read `src/core/db/schema.ts` rather than trusting the shape above, and use a `siteId` that exists in `EXPEDITION_SITES`.

Append to `tests/alert-buttons.test.ts`:

```ts
it('exp:claim rejects a bystander', async () => {
  const ctx = makeCtx();
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
  const comp = expeditionsModule.components.find((c) => c.prefix === 'exp')!;
  const b = fakeButton({ customId: 'exp:claim:u1', user: 'nope' });
  await comp.execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
  expect(JSON.stringify(b.replies[0])).toContain('not your');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/notify-handlers.test.ts tests/alert-buttons.test.ts`
Expected: FAIL — `components` is empty; `exp` prefix does not exist.

- [ ] **Step 3: Add the buttons to the three notification handlers**

In `src/core/notify.ts`, each handler gains a `components` array. For `eggHatchHandler`, reuse the existing crack button rather than building a new one — `crackButton(eggId)` in `src/modules/hatchery/embeds.ts:14-18` already produces `hatch:crack:<eggId>`, and `hatchEgg` filters on `(id, userId)` and throws `HatcheryError('You do not own that egg.')` which the crack branch turns into an ephemeral, so it needs no owner segment:

```ts
      payload.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`hatch:crack:${egg.id}`)
          .setLabel('🥚 Hatch').setStyle(ButtonStyle.Primary))];
```

For `breedingReadyHandler`:

```ts
      payload.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`breed:claim:${b.id}`)
          .setLabel('🧬 Claim').setStyle(ButtonStyle.Primary))];
```

For `expeditionReturnHandler`:

```ts
      payload.components = [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`exp:claim:${t.userId}`)
          .setLabel('🧭 Claim').setStyle(ButtonStyle.Primary))];
```

Add `ActionRowBuilder, ButtonBuilder, ButtonStyle` to the value import from `discord.js` at the top of `notify.ts` (it currently imports `EmbedBuilder` as a value and the rest as types).

- [ ] **Step 4: Add the `breed:claim` branch**

In `src/modules/genelab/index.ts`, inside the existing `breed` component, replace the `if (action !== 'confirm') return;` guard with a claim branch ahead of it:

```ts
        const [, action, aRaw, bRaw] = i.customId.split(':');
        if (action === 'claim') {
          const id = Number(aRaw);
          if (!Number.isInteger(id)) {
            await i.reply({ content: 'That claim link is invalid — use `/breed claim`.', flags: MessageFlags.Ephemeral });
            return;
          }
          try {
            // claimBreeding filters on (id, userId), so ownership is enforced server-side
            // exactly as it is for the slash command — the customId is never trusted.
            const { egg } = claimBreeding(ctx, i.user.id, id);
            await i.update({
              content: `🧬 Claimed — a **${egg.rarity}** egg is yours. Incubate it with \`/incubate egg:${egg.id}\`.`,
              embeds: [], components: [], attachments: [],
            });
          } catch (e) {
            if (e instanceof BreedError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
            else throw e;
          }
          return;
        }
        if (action !== 'confirm') { await i.deferUpdate(); return; }
```

Import `claimBreeding` from `./service.js` if it is not already imported in this file.

- [ ] **Step 5: Add the `exp` component prefix**

In `src/modules/expeditions/index.ts`, replace `components: []` at the end of the manifest:

```ts
  components: [
    {
      prefix: 'exp',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        if (action !== 'claim') { await i.deferUpdate(); return; }
        // The notification is a DM today, but a customId is client-supplied and this
        // handler is reachable from anywhere — check the owner explicitly.
        if (i.user.id !== uid) {
          await i.reply({ content: 'That is not your expedition.', flags: MessageFlags.Ephemeral });
          return;
        }
        try {
          const { loot, site } = claimExpedition(ctx, i.user.id);
          await i.update({
            content: `🧭 **${site.name}** claimed — a **${loot.eggRarity}** egg, **${loot.cash}** cash, and **${loot.food.qty}× ${FOODS[loot.food.foodId].name}**.`,
            embeds: [], components: [], attachments: [],
          });
        } catch (e) {
          if (e instanceof ExpeditionError) await i.reply({ content: e.message, flags: MessageFlags.Ephemeral });
          else throw e;
        }
      },
    },
  ],
```

`claimExpedition`, `ExpeditionError`, `FOODS`, and `MessageFlags` are already imported in that file; verify before adding duplicates.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run tests/notify-handlers.test.ts tests/alert-buttons.test.ts tests/genelab.test.ts tests/expeditions.test.ts tests/contract.test.ts`
Expected: PASS. `contract.test.ts` verifies the new `exp` prefix does not collide — `ModuleRegistry` throws on a duplicate prefix across enabled modules.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/core/notify.ts src/modules/expeditions/index.ts src/modules/genelab/index.ts tests/
git commit -m "Put action buttons on the three completion notifications"
```

---

### Task 11: Admin coverage

**Files:**
- Modify: `src/modules/admin/service.ts:41-77` (`adminReset`)
- Test: `tests/admin.test.ts`

**Interfaces:**
- Consumes: `schema.alertsSent` from Task 1.
- Produces: no new exports; `adminReset` now clears `alerts_sent`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/admin.test.ts`:

```ts
it('adminReset deletes alert records but preserves an explicit mute', async () => {
  const ctx = makeCtx();
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: 0, createdAt: 0 }).run();
  ctx.db.update(schema.users).set({ alertsEnabled: false })
    .where(eq(schema.users.discordId, 'u1')).run();
  ctx.db.insert(schema.alertsSent).values({
    userId: 'u1', kind: 'escape', refId: 1, tier: 'heads_up', firedForMs: 5, sentAt: 5,
  }).run();

  adminReset(ctx, 'u1');

  // Reset must clear every table the feature reads — the breedings/user_stats lesson.
  expect(ctx.db.select().from(schema.alertsSent).all()).toHaveLength(0);
  // But NOT the mute: it is communication consent, not progress. Un-muting a player who
  // explicitly opted out would be a reset that talks to them again without asking.
  expect(ctx.db.select().from(schema.users).where(eq(schema.users.discordId, 'u1')).get()!.alertsEnabled).toBe(false);
});

it('adminFastForward does not shift alert records, which is what lets it force an alert', () => {
  // Shifting lastFedAt moves escapeAt; firedForMs then stops matching and the next sweep
  // alerts. Shifting the record too would keep them in lockstep and force nothing.
  const ctx = makeCtx({ nowMs: 100 * 3_600_000 });
  ctx.db.insert(schema.users).values({ discordId: 'u1', lastCollectAt: ctx.now(), createdAt: 0 }).run();
  ctx.db.insert(schema.alertsSent).values({
    userId: 'u1', kind: 'income_cap', refId: 0, tier: '', firedForMs: 5, sentAt: 5,
  }).run();
  adminFastForward(ctx, 'u1', 24);
  const row = ctx.db.select().from(schema.alertsSent).all()[0];
  expect(row.firedForMs).toBe(5);
  expect(row.sentAt).toBe(5);
});
```

- [ ] **Step 2: Run to verify the first fails**

Run: `npx vitest run tests/admin.test.ts -t "alert"`
Expected: the first FAILS (`alerts_sent` still has 1 row); the second already PASSES, which is correct — it is a regression guard against a future "shift everything" change.

- [ ] **Step 3: Add the delete**

In `src/modules/admin/service.ts`, inside `adminReset`'s transaction, beside the other feature-table deletes:

```ts
    // Same rule the breedings and user_stats fixes taught: reset must delete from every
    // table the feature reads. A surviving alerts_sent row would suppress the first
    // alert a "fresh" account earns.
    ctx.db.delete(schema.alertsSent).where(eq(schema.alertsSent.userId, targetId)).run();
```

Then add a comment to the `users` defaults `set()` block explaining the deliberate omission:

```ts
    // alertsEnabled is deliberately NOT reset. Every other column here is progress or a
    // cosmetic default; this one is communication consent. Restoring it would start
    // DMing a player who explicitly opted out.
    ctx.db.update(schema.users).set({
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/admin.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
npm test && npm run typecheck
git add src/modules/admin/service.ts tests/admin.test.ts
git commit -m "Make admin reset clear alert records without un-muting the player"
```

---

### Task 12: Documentation

**Files:**
- Modify: `docs/commands.md:110` and the park command table
- Modify: `docs/gameplay.md:819-880`
- Modify: `docs/ops.md:396`, `:421`
- Modify: `src/modules/help/index.ts:56` (care topic)
- Modify: `CLAUDE.md`

- [ ] **Step 1: Fix the falsified statements**

Read each line before editing — line numbers drift. The statements this feature makes false:

| File | What is now false |
| --- | --- |
| `docs/commands.md:110` | the notification-type list omits the two alerts |
| `docs/gameplay.md:819` | §14 heading |
| `docs/gameplay.md:821` | "five things" |
| `docs/gameplay.md:823-825` | "no hunger or escape notifications of any kind" |
| `docs/gameplay.md:845` | "three timer-based" (now four) |
| `docs/gameplay.md:851` | "four per-player notifications" |
| `docs/gameplay.md:863` | "checked roughly every 30 seconds" |
| `docs/gameplay.md:876-880` | "There's no per-player notification preference anywhere in the game" |
| `docs/ops.md:396`, `:421` | smoke-test steps |

Add a `/park alerts` row to the park command table in `docs/commands.md`.

- [ ] **Step 2: Update the care help topic**

`src/modules/help/index.ts:56` currently reads "Low comfort long enough → the dino escapes and stops earning." Extend it:

```ts
    'Hunger drains over 48h. Low comfort long enough → the dino escapes and stops earning.',
    'You get a DM 12h before a dino escapes, and a last call 1h out — `/park alerts state:off` to stop them.',
```

- [ ] **Step 3: Add the CLAUDE.md bullet and the three corrections**

Add one bullet covering: the `alert_sweep` sentinel and why it must never collide; level-trigger + `alerts_sent` (a record of a side effect, not derived state); the tier-collapse direction; that the sweep must never call `settleEscapes`; and the `/park` dispatch trap.

Then correct three existing statements:
- The `Sender` fake list is **four** files, not three — it omits `tests/world-broadcast.test.ts`.
- Channel notifications did not ping before this change; `withMention` now carries a per-message `allowedMentions`.
- Never put an `attachments` key on a payload reaching `deliverNotification` — one object, two send sites.

- [ ] **Step 4: Verify and commit**

```bash
npm test && npm run typecheck
git add docs/ CLAUDE.md src/modules/help/index.ts
git commit -m "Document the proactive alerts and correct three stale claims"
```

---

### Task 13: `test:live` gallery coverage

**Files:**
- Modify: `scripts/test-live.ts:176` (`Case`), the seed block, and the `cases` array

**Interfaces:**
- Consumes: `alertPayload`, `alertSweepHandler` from Tasks 7-8.
- Produces: gallery cases for the combined alert and its buttons.

**Why this needs a structural change, not two array entries:** `Case.run()` is typed to return a `FakeInteraction` and the driver throws `'no reply captured'` on an empty `replies` (`:348`). `scripts/` constructs no `Sender` and registers no timer kind. Also, the existing seed cannot trigger an alert — every dino is inserted `hunger: 100, lastFedAt: ctx.now()`, and `getOrCreateUser` stamps `lastCollectAt: ctx.now()` (`park/service.ts:29`).

- [ ] **Step 1: Widen the Case type**

```ts
// A case yields captured payloads. Most produce them via a FakeInteraction; the alert
// sweep produces them via a Sender fake, which has no interaction at all.
interface Capture { replies: unknown[] }
interface Case { title: string; run(): Promise<Capture> }
```

`FakeInteraction` already structurally satisfies `Capture`, so no existing case changes.

- [ ] **Step 2: Add a sweep case**

```ts
const sweepCapture = async (): Promise<Capture> => {
  const replies: unknown[] = [];
  const sender: Sender = {
    channelSend: async () => { throw new Error('alerts are DM-only'); },
    dmSend: async (_u, payload) => { replies.push(payload); },
  };
  // Drive the park into both alert conditions: a starving assigned dino and an
  // un-collected income window past the 8h default cap.
  ctx.db.update(schema.dinos)
    .set({ lastFedAt: ctx.now() - 40 * 3_600_000 })
    .where(eq(schema.dinos.userId, P1)).run();
  ctx.db.update(schema.users)
    .set({ lastCollectAt: ctx.now() - 12 * 3_600_000 })
    .where(eq(schema.users.discordId, P1)).run();
  await alertSweepHandler(sender, ctx as Ctx)({
    id: 1, kind: ALERT_TIMER, userId: '0', refId: 0, originGuildId: null,
    firesAt: ctx.now(), handledAt: null,
  });
  return { replies };
};
```

Add to the `cases` array:

```ts
  { title: 'alert sweep — combined escape + income cap DM', run: sweepCapture },
  { title: 'alert:mute — muted confirmation', run: () => button('park', `alert:mute:${P1}`, P1) },
```

Place the sweep case **last** among P1's cases — it mutates `lastFedAt` and `lastCollectAt`, which earlier cases read.

- [ ] **Step 3: Verify**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run test:live` (needs `TEST_CHANNEL_ID` and a token; REST-only, safe against the dev guild while the bot is live)
Expected: every case ok. Review the alert embed's art and button row by eye in the channel.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-live.ts
git commit -m "Cover the alert payload and its buttons in the live gallery"
```

---

## Ops checklist (after merge)

1. `npm run deploy-commands` — the top-level count stays 25, but the `/park` builder changed. Exactly one bot instance per token.
2. Restart the bot — migration 0009 applies via `migrateDb`, and `alert_sweep` must be registered before `armAlertSweep` can arm it.
3. `npm run test:live` — cosmetic review of the alert payload and the five button rows.

No emoji work: `banners/care_neglect.webp` and `banners/collect.webp` are already committed.

---

## Self-review notes

**Spec coverage.** §4 sweep → Tasks 4, 8. §5 predicates and message → Tasks 5, 6, 7. §6 buttons → Tasks 9, 10. §7 ping repair → Task 2. §8 migration, `/park alerts`, dispatch trap → Tasks 1, 3. §9 admin → Task 11. §10 testing → distributed across every task, plus the `test:live` change in Task 13. §11 docs → Task 12. §13 invariants → each is enforced by a named test.

**Two things a reviewer should check hardest:**
1. Task 1 Step 2 — that drizzle-kit emitted an `ALTER TABLE ... ADD`, not a `__new_users` recreate. A recreate would fail on a populated production DB and pass every test.
2. Task 9 Step 3 — that the `alert` component was **appended** to `parkModule.components`. `tests/dinos.test.ts` indexes `[0]`.
