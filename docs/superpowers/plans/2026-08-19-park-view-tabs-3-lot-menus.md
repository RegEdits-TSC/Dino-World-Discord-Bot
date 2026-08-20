# Lots Tab Build and Upgrade Menus Implementation Plan (PR 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put working Build and Upgrade select menus on the Lots tab, each behind a confirm click, without ever charging more than the label the player read.

**Architecture:** Two string select menus on the Lots tab. Selecting an option does not spend — it swaps the card into a confirm state whose Yes button carries the exact thing being bought. Every client-supplied value is validated three times: against the message's own option list, against an explicit allowlist or integer parse, and against a fresh database read.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js 14.27.0, vitest, better-sqlite3 + drizzle.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()`.
- DB access is synchronous drizzle/better-sqlite3, never awaited.
- Prices are **re-derived at execution** by the service layer. A menu option's `value` carries identity plus a staleness anchor and **never a number** — any price in a label is a display copy the handler never reads back.
- Client-supplied values are validated against a real union or an explicit allowlist, never cast, and never looked up through a plain-object key.
- Rejections use `deferUpdate()` or a specific ephemeral message; never a bare `return`.
- No authorship attribution of any kind in commits, code comments, or docs.

**Depends on:** PR 2 (`2026-08-19-park-view-tabs-2-select-routing.md`) merged — this plan uses `SelectDef`, `fakeSelect`, the router's select branch and `submittedValuesAreOnMessage`. PR 1 merged — this plan modifies `lotsPayload`.

## The incident this plan exists to not repeat

`park:landmark:buy` shipped with no tier in its customId. Its label froze at render while `buyLandmark` re-derived `current + 1` on every click, so four clicks of one button labelled "Build Stone Marker" charged 5,000,000 then 10,000,000 then 20,000,000 then 40,000,000 — **32x its own label**, against a feature with no refund path.

The Upgrade menu is a worse version of the same shape. `upgradeCostFor` is a pure function of `(kind, level)` and paddock cost is `buildCost * 2.5 ** level`, so a stale option charges the *next* rung's price. The measured worst case is `hatchery_lab`: a label reading 25,000 against a charge of 2,250,000 — **90x**.

---

### Task 1: Build menu and its confirm step

**Files:**
- Modify: `src/modules/park/embeds.ts` (`lotsPayload`), `src/modules/park/index.ts`
- Test: `tests/lot-menus.test.ts` (create)

**Interfaces:**
- Consumes: `lotsPayload` (PR 1), `submittedValuesAreOnMessage` (PR 2), `SelectDef` (PR 2).
- Produces:
  - `lotsPayload` gains `opts.buildable?: Array<{ kind: string; name: string; cost: number }>` and mints `park:build:<uid>` when it is non-empty.
  - `export function confirmPayload(user: User, question: string, yesId: string, noId: string, yesLabel: string)` in `embeds.ts`.
  - Handlers for the `park` select prefix and for `park:buildyes:<uid>:<kind>` / `park:buildno:<uid>`.

- [ ] **Step 1: Write the failing test**

Create `tests/lot-menus.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { makeCtx, fakeButton, fakeSelect } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { parkModule } from '../src/modules/park/index.js';
import { schema } from '../src/core/db/index.js';
import { eq } from 'drizzle-orm';

let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); });

const parkComp = () => parkModule.components.find((c) => c.prefix === 'park')!;
const parkSelect = () => parkModule.selects!.find((s) => s.prefix === 'park')!;
const cashOf = (id: string) =>
  ctx.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

describe('build menu', () => {
  it('asks for confirmation rather than spending on the selection itself', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['carnivore_paddock'], options: ['carnivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    const json = JSON.stringify(s.replies[0]);
    expect(json).toContain('park:buildyes:u1:carnivore_paddock');
    expect(json).toContain('park:buildno:u1');
  });

  it('builds only after the confirm click', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:carnivore_paddock', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBeLessThan(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(1);
  });

  it('rejects a prototype key, which buildLot own check does NOT catch', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 10_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    const before = cashOf('u1');
    const b = fakeButton({ customId: 'park:buildyes:u1:constructor', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, 'u1')).all()).toHaveLength(0);
    expect(JSON.stringify(b.replies[0])).toContain('no longer valid');
  });

  it('rejects a value the minted menu never offered', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1',
      values: ['gene_lab'], options: ['carnivore_paddock'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(s.deferOpts).toEqual([{ kind: 'update' }]);
    expect(s.replies).toEqual([]);
  });

  it('refuses a stranger driving the menu', async () => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u2', values: ['gene_lab'], options: ['gene_lab'],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(JSON.stringify(s.replies[0])).toContain('Not your park');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lot-menus.test.ts -t "build menu"`

Expected: FAIL — `parkModule.selects` is `undefined`.

- [ ] **Step 3: Mint the menu on the Lots tab**

In `src/modules/park/embeds.ts`, extend `lotsPayload`'s options and add the menu. Import `StringSelectMenuBuilder` and `StringSelectMenuOptionBuilder` from `discord.js`.

```ts
export function lotsPayload(
  user: User, lots: Lot[], slots: number,
  opts: { visit?: boolean; buildable?: Array<{ kind: string; name: string; cost: number }> } = {},
) {
```

Replace the `Building` hint field and the components array with:

```ts
  const components: Array<ActionRowBuilder<ButtonBuilder> | ActionRowBuilder<StringSelectMenuBuilder>> = [];
  const buildable = opts.buildable ?? [];
  if (!opts.visit && buildable.length > 0) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`park:build:${user.discordId}`)
        .setPlaceholder('Build…')
        // Discord caps a select at 25 options. Six kinds exist today; the slice is
        // insurance against a future catalog, not a live constraint.
        .addOptions(buildable.slice(0, 25).map((b) => new StringSelectMenuOptionBuilder()
          // The value is the KIND alone — an identity, never a price. Cost is re-derived
          // by buildLot at execution; this label is a display copy nothing reads back.
          .setValue(b.kind)
          .setLabel(`${b.name} — ${b.cost.toLocaleString('en-US')} cash`))),
    ));
  }
  components.push(tabRow(user.discordId, 'lots', opts.visit));
```

and set `{ embeds: [embed], components }` on the payload. Keep the `Building` hint field only when `buildable.length === 0 && !opts.visit`, with the text `'No room for another lot — raise your park rating for more slots.'`

- [ ] **Step 4: Add the confirm payload builder**

In `src/modules/park/embeds.ts`:

```ts
/**
 * A yes/no confirm rendered onto the card the player is already standing on, rather than
 * an ephemeral follow-up: the Lots tab must not be left displaying a state it is about to
 * change, and an ephemeral would accumulate one message per attempt.
 *
 * The thing being bought rides in `yesId`, never in this builder — see the
 * park:landmark:buy incident. This builder only renders what it is handed.
 */
export function confirmPayload(user: User, question: string, yesId: string, noId: string, yesLabel: string) {
  const embed = new EmbedBuilder()
    .setTitle(`🏗️ ${user.parkName} — Confirm`)
    .setColor(0xc9a227)
    .setDescription(question)
    .addFields({ name: `${emojiTag('dw_cash')} Your cash`, value: user.cash.toLocaleString(), inline: true });
  return {
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(yesId).setLabel(yesLabel).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(noId).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
    )],
  };
}
```

- [ ] **Step 5: Add the select handler and the confirm buttons**

In `src/modules/park/index.ts`, pass `buildable` wherever `lotsPayload` is called (in `renderTab`):

```ts
  if (tab === 'lots') {
    const owned = new Set(lots.map((l) => l.kind));
    const full = lots.length >= lotSlots(user.ratingHighWater);
    // Facilities are one per park; paddocks are duplicable — building more of one kind IS
    // the capacity progression. Filtering here keeps the menu honest, but it is NOT the
    // guard: buildLot re-checks both, and a stale menu is rejected there.
    const buildable = full ? [] : [
      ...Object.entries(PADDOCKS).map(([kind, d]) => ({ kind, name: d.name, cost: d.buildCost })),
      ...Object.entries(FACILITIES)
        .filter(([kind]) => !owned.has(kind))
        .map(([kind, d]) => ({ kind, name: d.name, cost: d.buildCost })),
    ];
    await i.update({ ...lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit, buildable }), attachments: [] });
    return;
  }
```

Add the `selects` array to `parkModule`, beside `components`:

```ts
  selects: [
    {
      prefix: 'park',
      async execute(ctx, i) {
        const [, action, uid] = i.customId.split(':');
        if (i.user.id !== uid) {
          await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
          return;
        }
        // The router already proved the bot minted THIS MENU on THIS MESSAGE. It proved
        // nothing about the submitted values, which arrive on a separate client-supplied
        // channel — so they are checked against the message's own option list here.
        if (!submittedValuesAreOnMessage(i)) { await i.deferUpdate(); return; }
        const value = i.values[0]!;
        const user = ctx.db.select().from(schema.users)
          .where(eq(schema.users.discordId, i.user.id)).get()!;
        if (action === 'build') {
          // Explicit allowlist, NOT buildLot's own `!paddock && !facility` check: that
          // check does not fire for a prototype key — PADDOCKS['constructor'] resolves up
          // the chain to Object and reads back truthy — and the write survives today only
          // because the resulting NaN cost binds as NULL against a NOT NULL column.
          if (!Object.hasOwn(PADDOCKS, value) && !Object.hasOwn(FACILITIES, value)) {
            await i.deferUpdate();
            return;
          }
          const def = PADDOCKS[value] ?? FACILITIES[value]!;
          await i.update(confirmPayload(
            user,
            `Build **${def.name}** for **${def.buildCost.toLocaleString('en-US')}** cash?`,
            `park:buildyes:${i.user.id}:${value}`, `park:buildno:${i.user.id}`,
            `Build ${def.name}`,
          ));
          return;
        }
        await i.deferUpdate();
      },
    },
  ],
```

Add to the component `switch (action)`:

```ts
          case 'buildno':
          case 'upgno': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            await renderTab(ctx, i, i.user.id, 'lots', false);
            return;
          }
          case 'buildyes': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            const kind = parts[3] ?? '';
            // Re-validated here and not merely at the menu: another open message may still
            // hold a stale confirm button, and the customId is client-supplied regardless.
            if (!Object.hasOwn(PADDOCKS, kind) && !Object.hasOwn(FACILITIES, kind)) {
              await i.reply({
                content: 'That build button is no longer valid — open `/park view` again.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              const lot = buildLot(ctx, i.user.id, kind);
              await renderTab(ctx, i, i.user.id, 'lots', false, `🏗️ Built **${lot.name}** (lot #${lot.id}).`);
            } catch (e) {
              // Mapped for the BUILD menu specifically: LotLimitError means "slot cap" here
              // and "already max level" in upgradeLot, and UnknownKindError is likewise
              // overloaded. Reusing /upgrade's mapping would tell a player "already max
              // level" when they meant "all lots full".
              if (e instanceof DuplicateFacilityError) {
                await i.reply({ content: `You already have a ${e.message} — upgrade it instead.`, flags: MessageFlags.Ephemeral });
              } else if (e instanceof LotLimitError) {
                await i.reply({ content: 'All lots full. More slots unlock with park rating.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof InsufficientFundsError) {
                const def = PADDOCKS[kind] ?? FACILITIES[kind]!;
                await i.reply({
                  content: `Not enough cash — ${def.name} costs ${def.buildCost.toLocaleString('en-US')}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
            return;
          }
```

Add imports to `src/modules/park/index.ts`:

```ts
import { submittedValuesAreOnMessage } from '../../core/components.js';
import { confirmPayload } from './embeds.js';
```

`PADDOCKS`, `FACILITIES`, `buildLot`, `DuplicateFacilityError`, `LotLimitError` and `InsufficientFundsError` are already imported.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/lot-menus.test.ts -t "build menu"`

Expected: PASS, five cases.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS. `tests/park-tabs.test.ts`'s Lots cases may need `buildable` added where they assert on components; update them rather than loosening the assertions.

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/lot-menus.test.ts tests/park-tabs.test.ts
git commit -m "Add the Lots tab build menu behind a confirm

The option value is the kind alone — an identity, never a price — and cost is
re-derived by buildLot at execution. Validated with an explicit Object.hasOwn
allowlist rather than buildLot's own check, which does not fire for a
prototype key: PADDOCKS['constructor'] resolves up the chain to Object and
reads back truthy, and the write survives today only because the resulting
NaN cost binds as NULL against a NOT NULL column."
```

---

### Task 2: Upgrade menu with a staleness anchor

**Files:**
- Modify: `src/modules/park/embeds.ts`, `src/modules/park/index.ts`
- Test: `tests/lot-menus.test.ts`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `lotsPayload` gains `opts.upgradable?: Array<{ lotId: number; name: string; level: number; cost: number }>`, minting `park:upgrade:<uid>` whose option values are `<lotId>:<expectedLevel>`. Handlers for `park:upgyes:<uid>:<lotId>:<expectedLevel>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('upgrade menu', () => {
  const seedLot = (level: number) => {
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.db.update(schema.users).set({ cash: 100_000_000 })
      .where(eq(schema.users.discordId, 'u1')).run();
    return ctx.db.insert(schema.lots).values({
      userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level,
    }).returning().get();
  };

  it('carries the level it was minted for in the option value', async () => {
    const lot = seedLot(1);
    const s = fakeSelect({
      customId: 'park:upgrade:u1', user: 'u1',
      values: [`${lot.id}:1`], options: [`${lot.id}:1`],
    });
    await parkSelect().execute(ctx, s.asInteraction() as never);
    expect(JSON.stringify(s.replies[0])).toContain(`park:upgyes:u1:${lot.id}:1`);
  });

  it('upgrades once when the level still matches', async () => {
    const lot = seedLot(1);
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const after = ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!;
    expect(after.level).toBe(2);
  });

  // The park:landmark:buy incident, in its new home. Worst measured case is 90x.
  it('refuses a stale button and charges nothing', async () => {
    const lot = seedLot(1);
    const first = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, first.asInteraction() as never);
    const afterFirst = cashOf('u1');
    // The same button clicked again: its label still says level 1 to 2, but the lot is
    // level 2 now and upgradeCostFor would charge the level-2 price.
    const second = fakeButton({ customId: `park:upgyes:u1:${lot.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, second.asInteraction() as never);
    expect(cashOf('u1')).toBe(afterFirst);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(2);
    expect(JSON.stringify(second.replies[0])).toContain('no longer');
  });

  it('refuses a forged lot id belonging to someone else', async () => {
    seedLot(1);
    getOrCreateUser(ctx, 'u2', 'Other');
    const theirs = ctx.db.insert(schema.lots).values({
      userId: 'u2', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 1,
    }).returning().get();
    const b = fakeButton({ customId: `park:upgyes:u1:${theirs.id}:1`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, theirs.id)).get()!.level).toBe(1);
  });

  it('refuses a non-integer level anchor without touching the database', async () => {
    const lot = seedLot(1);
    const before = cashOf('u1');
    const b = fakeButton({ customId: `park:upgyes:u1:${lot.id}:notanumber`, user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(cashOf('u1')).toBe(before);
    expect(ctx.db.select().from(schema.lots).where(eq(schema.lots.id, lot.id)).get()!.level).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/lot-menus.test.ts -t "upgrade menu"`

Expected: FAIL — no `park:upgrade` menu and no `upgyes` case.

- [ ] **Step 3: Mint the upgrade menu**

In `lotsPayload`, add after the build menu:

```ts
  const upgradable = opts.upgradable ?? [];
  if (!opts.visit && upgradable.length > 0) {
    components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`park:upgrade:${user.discordId}`)
        .setPlaceholder('Upgrade…')
        .addOptions(upgradable.slice(0, 25).map((u) => new StringSelectMenuOptionBuilder()
          // <lotId>:<expectedLevel> — the level it was minted for is the staleness anchor.
          // upgradeCostFor is a pure function of (kind, level), so without it a stale
          // option silently charges the NEXT rung's price: measured worst case is a
          // hatchery_lab label reading 25,000 against a 2,250,000 charge, 90x.
          .setValue(`${u.lotId}:${u.level}`)
          .setLabel(`#${u.lotId} ${u.name} → lvl ${u.level + 1} — ${u.cost.toLocaleString('en-US')} cash`))),
    ));
  }
```

Extend the signature:

```ts
  opts: { visit?: boolean;
          buildable?: Array<{ kind: string; name: string; cost: number }>;
          upgradable?: Array<{ lotId: number; name: string; level: number; cost: number }> } = {},
```

- [ ] **Step 4: Compute `upgradable` in `renderTab`**

In the `lots` branch, beside `buildable`:

```ts
    const upgradable = lots
      .filter((l) => l.level < (FACILITIES[l.kind]?.maxLevel ?? 4))
      .map((l) => ({ lotId: l.id, name: l.name, level: l.level, cost: upgradeCostFor(l.kind, l.level) }));
```

and pass it through to `lotsPayload`.

- [ ] **Step 5: Handle the upgrade selection and its confirm**

In the select handler, before the trailing `deferUpdate`:

```ts
        if (action === 'upgrade') {
          const [lotStr, levelStr] = value.split(':');
          const lotId = Number(lotStr); const expected = Number(levelStr);
          if (!Number.isInteger(lotId) || !Number.isInteger(expected)) { await i.deferUpdate(); return; }
          const lot = ctx.db.select().from(schema.lots)
            .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
          if (!lot || lot.level !== expected) {
            await i.reply({
              content: 'That lot changed — open `/park view` again for current prices.',
              flags: MessageFlags.Ephemeral,
            });
            return;
          }
          await i.update(confirmPayload(
            user,
            `Upgrade **${lot.name}** to level ${lot.level + 1} for **${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}** cash?`,
            `park:upgyes:${i.user.id}:${lotId}:${expected}`, `park:upgno:${i.user.id}`,
            `Upgrade to lvl ${lot.level + 1}`,
          ));
          return;
        }
```

In the component `switch (action)`:

```ts
          case 'upgyes': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            // park:upgyes:<uid>:<lotId>:<expectedLevel> — both client-supplied. Parsed as
            // integers first, then checked against a FRESH read, in that order, before any
            // write. This is the guard, not the confirm click: another open message may
            // still hold a stale button for the same lot.
            const lotId = Number(parts[3]); const expected = Number(parts[4]);
            if (!Number.isInteger(lotId) || !Number.isInteger(expected)) {
              await i.reply({ content: 'That upgrade button is no longer valid — open `/park view` again.', flags: MessageFlags.Ephemeral });
              return;
            }
            const lot = ctx.db.select().from(schema.lots)
              .where(and(eq(schema.lots.id, lotId), eq(schema.lots.userId, i.user.id))).get();
            if (!lot || lot.level !== expected) {
              await i.reply({
                content: lot
                  ? `That lot is level ${lot.level} now, not ${expected} — open \`/park view\` again for the current price.`
                  : 'No such lot.',
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            try {
              const upgraded = upgradeLot(ctx, i.user.id, lotId);
              await renderTab(ctx, i, i.user.id, 'lots', false, `⬆️ **${upgraded.name}** is now level ${upgraded.level}.`);
            } catch (e) {
              // Mapped for the UPGRADE menu: LotLimitError means "already max level" here,
              // where the build handler reads the same class as "slot cap".
              if (e instanceof LotLimitError) {
                await i.reply({ content: 'Already max level.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof UnknownKindError) {
                await i.reply({ content: 'No such lot.', flags: MessageFlags.Ephemeral });
              } else if (e instanceof InsufficientFundsError) {
                await i.reply({
                  content: `Not enough cash — that upgrade costs ${upgradeCostFor(lot.kind, lot.level).toLocaleString('en-US')}.`,
                  flags: MessageFlags.Ephemeral,
                });
              } else throw e;
            }
            return;
          }
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/lot-menus.test.ts -t "upgrade menu"`

Expected: PASS, five cases.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/lot-menus.test.ts
git commit -m "Add the Lots tab upgrade menu with a level anchor

The option value carries <lotId>:<expectedLevel> and the handler rejects a
mismatch against a fresh read before any write. upgradeCostFor is a pure
function of (kind, level) and paddock cost is geometric, so without the anchor
a stale option charges the next rung's price — measured worst case is a
hatchery_lab label reading 25,000 against a 2,250,000 charge. Error mapping is
per-menu: LotLimitError means slot cap for build and max level for upgrade."
```

---

### Task 3: Extend the real-payload sweep to select menus

**Files:**
- Modify: `tests/router.test.ts`

**Interfaces:**
- Consumes: the Lots tab's two menus (Tasks 1–2), `fakeSelect` (PR 2).
- Produces: the sweep covers type-3 components, not just type-2.

- [ ] **Step 1: Write the failing test**

The existing sweep walks `custom_id` type-agnostically but replays every harvested id through `fakeButton`, so a select is exercised as a button. Replace `idsOf` with a shape that records the component type, and replay accordingly:

```ts
  const componentsOf = (rows: ReadonlyArray<{ toJSON(): unknown }> = []) =>
    rows.flatMap((r) => ((r.toJSON() as {
      components?: Array<{ custom_id?: string; type?: number; options?: Array<{ value: string }> }>;
    }).components ?? [])
      .filter((c): c is { custom_id: string; type?: number; options?: Array<{ value: string }> } =>
        typeof c.custom_id === 'string'));
```

Add a select-bearing surface and assert it really carries one:

```ts
    const lotsTab = lotsPayload(user, [], 3, {
      buildable: [{ kind: 'carnivore_paddock', name: 'Carnivore Paddock', cost: 1000 }],
    }).components;
    expect(componentsOf(lotsTab).some((c) => c.type === 3),
      'the Lots tab minted no select — this case would be vacuous').toBe(true);
```

and in the replay loop, dispatch type 3 through `fakeSelect`:

```ts
      for (const c of comps) {
        const ids = comps.map((x) => x.custom_id);
        const fake = c.type === 3
          ? fakeSelect({
              customId: c.custom_id, user: 'u1',
              values: [c.options![0]!.value], options: c.options!.map((o) => o.value),
              componentIds: ids,
            })
          : fakeButton({ customId: c.custom_id, user: 'u1', componentIds: ids });
        await routeInteraction(ctx, registry, fake.asInteraction());
        expect(seen, `${label}: ${c.custom_id} was rejected by the guard`).toContain(c.custom_id);
      }
```

The synthetic registry must now carry `selects` as well as `components`, or every select is dropped for want of a handler:

```ts
      components: PREFIXES.map((prefix): ComponentDef => ({
        prefix, execute: async (_c, i) => { seen.push(i.customId); },
      })),
      selects: PREFIXES.map((prefix): SelectDef => ({
        prefix, execute: async (_c, i) => { seen.push(i.customId); },
      })),
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/router.test.ts -t "every live button surface"`

Expected: FAIL before the registry gains `selects` — the select is harvested, dispatched and dropped, so `seen` never contains its id.

- [ ] **Step 3: Apply the changes above and re-run**

Run: `npx vitest run tests/router.test.ts`

Expected: PASS.

- [ ] **Step 4: Rename the sweep so it stops lying**

Its describe block says "every live **button** surface still routes". It now covers selects too. Rename to `router component guard — every live component surface still routes` and update the block comment's counts to say buttons *and* select menus.

- [ ] **Step 5: Commit**

```bash
git add tests/router.test.ts
git commit -m "Cover select menus in the real-payload sweep

The sweep harvested a select's custom_id but replayed it through fakeButton,
so it proved only that the guard compares two strings — the exact vacuous pass
its own header comment says it exists to prevent."
```

---

### Task 4: Drive a select in the live gallery

**Files:**
- Modify: `scripts/test-live.ts`

- [ ] **Step 1: Add the driver**

`scripts/test-live.ts` renders a select with no change to `toPost`, but its `button()` helper cannot produce one. Add beside it, mirroring its shape:

```ts
const select = async (m: ModuleManifest, customId: string, user: string, values: string[]) => {
  const s = fakeSelect({ customId, user, values });
  await m.selects!.find((x) => x.prefix === customId.split(':')[0])!.execute(ctx, s.asInteraction() as never);
  return s;
};
```

- [ ] **Step 2: Add a gallery case**

Add a `Case` that renders the Lots tab with both menus populated, so the gallery shows the real option labels and their prices for cosmetic review.

- [ ] **Step 3: Note what this does and does not prove**

Add above the helper:

```ts
// This drives a select handler DIRECTLY, exactly as button() drives a component handler.
// It never calls routeInteraction, so a green run here is NOT evidence the router routes
// selects or that either guard fired — tests/router.test.ts owns that.
```

- [ ] **Step 4: Run it**

Run: `npm run test:live`

Expected: the gallery posts; the Lots tab card shows both dropdowns with real labels.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-live.ts
git commit -m "Drive select menus in the live gallery"
```

---

### Task 5: Documentation

**Files:**
- Modify: `docs/commands.md`, `docs/gameplay.md`, `CLAUDE.md`

- [ ] **Step 1: Update the player-facing docs**

In `docs/commands.md` and `docs/gameplay.md`, describe that the Lots tab can build and upgrade directly, behind a confirm, and that `/build` and `/upgrade` still work unchanged.

- [ ] **Step 2: Add the repo conventions**

Append to `CLAUDE.md`:

```markdown
- The Lots tab's Build and Upgrade select menus follow the `park:landmark:buy` lesson,
  which they would otherwise repeat in a worse form. A menu option's `value` is an
  IDENTITY plus a STALENESS ANCHOR and never a price: `park:build` carries `<kind>`,
  `park:upgrade` carries `<lotId>:<expectedLevel>`. Prices are re-derived by `buildLot` /
  `upgradeLot` at execution, and the label is a display copy no handler reads back.
  The level anchor is load-bearing: `upgradeCostFor` is a pure function of `(kind, level)`
  and paddock cost is `buildCost * 2.5 ** level`, so a stale option charges the NEXT rung's
  price. Measured worst case is `hatchery_lab` — a label reading 25,000 against a charge of
  2,250,000, **90x**, against the landmark defect's 32x.
  Build validates its kind with an explicit `Object.hasOwn(PADDOCKS, kind) ||
  Object.hasOwn(FACILITIES, kind)` and NEVER relies on `buildLot`'s own
  `!paddock && !facility` check: `PADDOCKS['constructor']` resolves up the prototype chain
  to `Object` and reads back truthy, so that check does not fire. Today the write still
  fails — the resulting `NaN` cost binds as `NULL` against `users.cash NOT NULL` — but that
  is a schema accident, not validation. `/build` cannot reach it because its `kind` comes
  from `addChoices`; a select menu value can.
  Error mapping is PER MENU. The service layer overloads two classes: `UnknownKindError`
  means unknown *kind* in `buildLot` and unknown *lot* in `upgradeLot`; `LotLimitError`
  means *slot cap* in one and *already max level* in the other. A shared mapping tells a
  player "All lots full" when they meant "already max level".
  Both spends sit behind a confirm rendered ONTO the card via `i.update`, never an
  ephemeral follow-up — the Lots tab must not be left displaying a state it is about to
  change. The confirm is a second layer only: the anchor check in the handler is the guard,
  because another open message may still hold a stale button.
```

- [ ] **Step 3: Commit**

```bash
git add docs/commands.md docs/gameplay.md CLAUDE.md
git commit -m "Document the lot build and upgrade menus"
```

---

## Verification before opening the PR

- [ ] `npm test` — full suite green
- [ ] `npm run typecheck` — exit 0
- [ ] `npm run build` — exit 0
- [ ] `npm run test:live` — Lots tab renders both dropdowns with correct labels and prices
- [ ] Manual check against a scratch database: build a lot from the menu, then click the **same** confirm button again and verify nothing is charged the second time
- [ ] No `deploy-commands` run — no builder changed

## Self-Review

**Spec coverage:** Task 1 covers spec §3.4 (the `Object.hasOwn` allowlist) and §3.7 (confirm); Task 2 covers §3.5 (the level anchor and the 90x figure) and §3.6 (per-menu error mapping); Task 3 covers the §7 sweep finding deferred from PR 2; Task 4 covers the `test-live` driver; Task 5 covers §9. Everything in the spec is now implemented across the four PRs.

**Placeholder scan:** Task 4 Step 2 says "add a `Case`" without quoting one, because `scripts/test-live.ts`'s `Case` shape was not read during planning and inventing its fields would be a fabricated type — the implementer must copy the shape of an adjacent case. Every code step that touches `src/` shows complete code.

**Type consistency:** `lotsPayload(user, lots, slots, opts)` gains `buildable` in Task 1 and `upgradable` in Task 2; both are optional, so PR 1's call sites and tests keep compiling. `confirmPayload(user, question, yesId, noId, yesLabel)` is used identically in Tasks 1 and 2. `renderTab(ctx, i, ownerId, tab, visit, content?)` matches the signature PR 1 Task 7 establishes. The select handler destructures `[, action, uid]` and the confirm handlers read `parts[3]`/`parts[4]`, consistent with `park:buildyes:<uid>:<kind>` and `park:upgyes:<uid>:<lotId>:<expectedLevel>`.
