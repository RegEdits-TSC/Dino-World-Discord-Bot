# Park View Tabs Implementation Plan (PR 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the eleven-field `/park view` card into four button-navigated tabs — Park, Animals, Lots, Prestige — swapped in place on one message.

**Architecture:** Four payload builders in `src/modules/park/embeds.ts`, each producing a fresh object with its own banner and its own `attachments: []`, plus a tab dispatcher in `src/modules/park/index.ts` that owner-checks, settles escapes once, and renders. The existing `dashboardPayload` export keeps its name and becomes the Park tab specifically, so `visit.ts` and the bulk of the test suite keep resolving it. Visited parks get the same tabs under a separate `park:vtab:` family with no owner check.

**Tech Stack:** TypeScript (ESM NodeNext), discord.js 14.27.0, vitest, better-sqlite3 + drizzle, `@napi-rs/canvas` for the park render.

## Global Constraints

- ESM NodeNext: every relative import carries a `.js` extension.
- Time comes from `ctx.now()`, randomness from `ctx.rng()` — never `Date.now()`/`Math.random()`.
- DB access is synchronous drizzle/better-sqlite3 (`.get()`/`.all()`/`.run()`), never awaited.
- Art is wired with `attach(embed, payload, slot, assetImage(...))` — **never** a hand-assigned `payload.files`, which `tests/images.test.ts` bans outright. `attach` APPENDS, and call order is upload order.
- Every file under `assets/images/` is WebP q95.
- Never call `emojiTag` in a module-level constant; never pass `rarityEmoji(...)` to `ButtonBuilder.setEmoji`.
- The test-inclusive gate is `npm run typecheck` (`tsc --noEmit -p tsconfig.test.json`). `npm run build` does not typecheck tests; `npm test` does not typecheck at all.
- No new command, subcommand or option — so **no `npm run deploy-commands`** for this PR.
- No authorship attribution of any kind in commits, code comments, or docs.

**Depends on:** `docs/superpowers/plans/2026-08-19-park-handler-default-arm.md` must be merged first. Task 6 adds `case 'tab'` to the `switch` that plan introduces.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/modules/park/embeds.ts` | All four tab payload builders, the tab row, the header strip. Pure — no cross-module imports, so no cycle. | Modify |
| `src/modules/park/index.ts` | Tab dispatcher, owner check, action buttons. The only place that may import foreign payload builders. | Modify |
| `src/modules/park/visit.ts` | The `park:vtab:` family and the read-only tab row. | Modify |
| `assets/images/banners/lots.webp` | Lots tab banner. | Create |
| `tests/park-tabs.test.ts` | Tab row, tab parsing, dispatcher, owner check, visit tabs. | Create |

`dinoListPayload` stays module-private inside `index.ts` — the dispatcher lives in the same file, so no export is needed. **Do not move the dispatcher into `embeds.ts` or `visit.ts`:** those import from `park/service.ts` and `park/rating.ts`, and reaching foreign payload builders from there creates a cycle with `leaderboards`.

---

### Task 1: Tab row and tab-id parsing

**Files:**
- Modify: `src/modules/park/embeds.ts`
- Test: `tests/park-tabs.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type ParkTab = 'park' | 'animals' | 'lots' | 'prestige'`
  - `export const PARK_TABS: readonly ParkTab[]`
  - `export function isParkTab(s: string): s is ParkTab`
  - `export function tabRow(id: string, active: ParkTab, visit?: boolean): ActionRowBuilder<ButtonBuilder>`

- [ ] **Step 1: Write the failing test**

Create `tests/park-tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PARK_TABS, isParkTab, tabRow } from '../src/modules/park/embeds.js';

describe('tab row', () => {
  it('mints one button per tab, owner ids for the own-park family', () => {
    const row = tabRow('u1', 'animals').toJSON();
    expect(row.components).toHaveLength(4);
    expect(row.components.map((c) => (c as { custom_id: string }).custom_id)).toEqual([
      'park:tab:u1:park', 'park:tab:u1:animals', 'park:tab:u1:lots', 'park:tab:u1:prestige',
    ]);
  });

  it('uses the vtab family when visiting', () => {
    const row = tabRow('target', 'park', true).toJSON();
    expect(row.components.map((c) => (c as { custom_id: string }).custom_id)).toEqual([
      'park:vtab:target:park', 'park:vtab:target:animals',
      'park:vtab:target:lots', 'park:vtab:target:prestige',
    ]);
  });

  it('disables the active tab so it cannot re-render itself', () => {
    const row = tabRow('u1', 'lots').toJSON();
    const disabled = row.components
      .filter((c) => (c as { disabled?: boolean }).disabled)
      .map((c) => (c as { custom_id: string }).custom_id);
    expect(disabled).toEqual(['park:tab:u1:lots']);
  });

  it('isParkTab rejects anything not in the union', () => {
    expect(PARK_TABS).toEqual(['park', 'animals', 'lots', 'prestige']);
    for (const t of PARK_TABS) expect(isParkTab(t)).toBe(true);
    expect(isParkTab('map')).toBe(false);
    expect(isParkTab('')).toBe(false);
    expect(isParkTab('__proto__')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts`

Expected: FAIL — `does not provide an export named 'PARK_TABS'`.

- [ ] **Step 3: Implement the tab row**

Add to `src/modules/park/embeds.ts`:

```ts
export type ParkTab = 'park' | 'animals' | 'lots' | 'prestige';

// Order is display order AND the order tabRow mints buttons in; tests pin it.
export const PARK_TABS: readonly ParkTab[] = ['park', 'animals', 'lots', 'prestige'];

const TAB_LABEL: Record<ParkTab, { label: string; emoji: string }> = {
  park: { label: 'Park', emoji: '🏞️' },
  animals: { label: 'Animals', emoji: '🦕' },
  lots: { label: 'Lots', emoji: '🏗️' },
  prestige: { label: 'Prestige', emoji: '🏛️' },
};

// The tab segment is CLIENT-supplied, so it is validated against the real union rather
// than cast — the parseDexFilters rule. `__proto__` and `constructor` are the reason this
// is an array membership test and not a lookup into TAB_LABEL: a prototype key reads back
// truthy from a plain object, which is exactly the hole buildLot has.
export function isParkTab(s: string): s is ParkTab {
  return (PARK_TABS as readonly string[]).includes(s);
}

/**
 * The navigation row. `id` is the OWNER's id for the own-park family and the TARGET's id
 * for the visit family — the visit tabs deliberately carry a target and are not owner
 * checked, the same shape park:tour already uses.
 *
 * Unicode glyphs in the label, never emojiTag/setEmoji: the app-emoji map returns '' when
 * unloaded and setEmoji throws on that rather than degrading.
 */
export function tabRow(id: string, active: ParkTab, visit = false): ActionRowBuilder<ButtonBuilder> {
  const action = visit ? 'vtab' : 'tab';
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...PARK_TABS.map((t) => new ButtonBuilder()
      .setCustomId(`park:${action}:${id}:${t}`)
      .setLabel(`${TAB_LABEL[t].emoji} ${TAB_LABEL[t].label}`)
      .setStyle(t === active ? ButtonStyle.Primary : ButtonStyle.Secondary)
      // The active tab is disabled so a click cannot re-render the screen already shown —
      // and this is a UX affordance ONLY, never a lock: the router guard does not read
      // `disabled`, so every handler still validates for itself.
      .setDisabled(t === active)),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts`

Expected: PASS, four cases.

- [ ] **Step 5: Commit**

```bash
git add src/modules/park/embeds.ts tests/park-tabs.test.ts
git commit -m "Add the park view tab row and tab-id validation"
```

---

### Task 2: Park tab payload

**Files:**
- Modify: `src/modules/park/embeds.ts` (`dashboardPayload`)
- Test: `tests/park.test.ts`, `tests/park-tabs.test.ts`

**Interfaces:**
- Consumes: `tabRow`, `ParkTab` from Task 1.
- Produces: `dashboardPayload` keeps its exported name and becomes the **Park tab** builder. New signature:
  ```ts
  export function dashboardPayload(
    user: User, pending: number,
    opts?: { attention?: number; capped?: boolean; now?: number; motto?: string;
             dinoCount?: number; visit?: boolean },
  ): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }
  ```
  `attention` is the count of **distinct dinos** needing attention — `escapedCount` plus the number of non-escaped dinos matching (at-risk OR wrong-habitat). Callers compute it; the builder only renders it.

  **Corrected during execution.** This originally read "the summed count of escaped + at-risk + wrong-habitat". That was wrong: at-risk and wrong-habitat are independent predicates over the same non-escaped rows, so one dino satisfies both freely and the marker could report more dinos needing attention than the park contains — `1 · ⚠️ 2 need attention` for a single off-diet dino inside the escape window. Not an edge case either, since an off-diet paddock is `paddockFit` 0.5, which is what drives comfort down and pulls `escapeAt` into the warning window. The Animals tab's itemised breakdown is unaffected and stays a sum: that tab lists *issues*, not dinos.

- [ ] **Step 1: Write the failing test**

Add to `tests/park-tabs.test.ts`:

```ts
import { makeCtx } from './harness.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { dashboardPayload } from '../src/modules/park/embeds.js';

const fieldsOf = (p: { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> }) =>
  p.embeds[0].toJSON().fields ?? [];

describe('Park tab', () => {
  it('carries only the headline numbers, not the full card', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 0, { dinoCount: 3 });
    const names = fieldsOf(p).map((f) => f.name);
    expect(names.some((n) => n.includes('Cash'))).toBe(true);
    expect(names.some((n) => n.includes('Rating'))).toBe(true);
    expect(names.some((n) => n.includes('Dinos'))).toBe(true);
    // These four moved to other tabs — the whole point of the change.
    for (const gone of ['Food', 'Attendance', 'Achievements', 'Legacy']) {
      expect(names.some((n) => n.includes(gone)), gone).toBe(false);
    }
  });

  it('shows a compact attention marker so an escape is never hidden behind a click', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const calm = dashboardPayload(user, 0, { dinoCount: 5 });
    expect(fieldsOf(calm).find((f) => f.name.includes('Dinos'))!.value).toBe('5');
    const alarmed = dashboardPayload(user, 0, { dinoCount: 5, attention: 2 });
    expect(fieldsOf(alarmed).find((f) => f.name.includes('Dinos'))!.value)
      .toBe('5 · ⚠️ 2 need attention');
  });

  it('puts Collect first in the first row and the tab row second', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 1234, {});
    const row0 = p.components[0].toJSON().components;
    expect((row0[0] as { custom_id: string }).custom_id).toBe('park:collect');
    expect(p.components[1].toJSON().components).toHaveLength(4);
  });

  it('drops Collect entirely on a visited card', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = dashboardPayload(user, 999, { visit: true });
    expect(JSON.stringify(p)).not.toContain('park:collect');
    expect(p.components[0].toJSON().components).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "Park tab"`

Expected: FAIL — the current `dashboardPayload` still renders Food/Attendance/Achievements/Legacy and its second positional parameter is `lots`, not `pending`.

- [ ] **Step 3: Rewrite `dashboardPayload` as the Park tab**

Replace the existing `dashboardPayload` in `src/modules/park/embeds.ts`:

```ts
/**
 * The PARK tab — the default screen of /park view. Deliberately keeps its old exported
 * name: visit.ts and a large part of the suite resolve it, and a rename would be churn
 * with no behavioural payoff.
 *
 * Cash and Rating are columns of the users row the caller already holds, so they cost
 * nothing and render on every tab as a header strip. `attention` is a SUM the caller
 * computes from one shared toClockDinos pass — the three underlying counts are free once
 * that read is paid for, and splitting them across tabs would pay it twice.
 */
export function dashboardPayload(
  user: User, pending: number,
  opts: { attention?: number; capped?: boolean; now?: number; motto?: string;
          dinoCount?: number; visit?: boolean } = {},
) {
  const attention = opts.attention ?? 0;
  const dinoValue = attention > 0
    ? `${opts.dinoCount ?? 0} · ⚠️ ${attention} need attention`
    : String(opts.dinoCount ?? 0);
  const embed = new EmbedBuilder()
    .setTitle(`🏞️ ${user.parkName}`)
    .setColor(0x3ba55c)
    .setDescription([
      eventHeaderLine(opts.now ?? 0, PARK_HEADER_KEYS),
      opts.motto ? `*“${opts.motto}”*` : '',
    ].filter(Boolean).join('\n'))
    .addFields(
      { name: `${emojiTag('dw_cash')} Cash`, value: user.cash.toLocaleString(), inline: true },
      { name: `${emojiTag('dw_star')} Rating`, value: (user.parkRating / 100).toFixed(1), inline: true },
      { name: '🦕 Dinos', value: dinoValue, inline: true },
    );
  if (opts.capped) {
    embed.addFields({ name: '⛔ Income capped', value: 'Idle earnings hit the Visitor Center cap — collect now to restart them.' });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  // Collect stays the FIRST button of the FIRST row: tests/park.test.ts reads
  // components[0].toJSON().components[0] positionally. Never reorder these two rows.
  if (!opts.visit) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('park:collect').setEmoji(emojiTag('dw_cash'))
        .setLabel(`Collect ${pending.toLocaleString()}`).setStyle(ButtonStyle.Success),
    ));
  }
  components.push(tabRow(user.discordId, 'park', opts.visit));
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[];
  } = { embeds: [embed], components };
  return payload;
}
```

Note what left: Food, Attendance, Achievements, Legacy, Seasons, Featured, the Lots list and the featured-dino `attach` call. Each reappears in Tasks 3–5.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts -t "Park tab"`

Expected: PASS, four cases.

- [ ] **Step 5: Repair the call sites the compiler flags**

Run: `npm run typecheck`

Expected: errors at `src/modules/park/index.ts`, `src/modules/park/visit.ts` **and `tests/router.test.ts:412`**, all passing the old `(user, lots, dinoCount, pending, escapedCount, opts)` shape.

`tests/router.test.ts:412` is the one that matters most and the one `npm test` alone will not show you — vitest transpiles without typechecking, so only `npm run typecheck` catches it. It is the real-payload sweep, the single piece of evidence that every button the game mints passes the router's forgery guard. Fix its surface entry to:

```ts
      ['/park view dashboard', idsOf(dashboardPayload(user, 1234, { now: ctx.now() }).components)],
```

Then in `index.ts` change the `/park view` call to:

```ts
        const attention = escapedCount + atRiskCount + mismatchCount;
        const base = dashboardPayload(user, pending, {
          attention, capped, now: nowMs, motto: user.motto, dinoCount: dinos.length,
        });
```

`bumpLegacyBest` stays on this path — it is the Park tab, the first thing every `/park view` renders, so the legacy high-water still latches on every view. Delete the now-unused `earnedTierCount`, `seasonBadges`, `featuredFor`, `attendanceOf` and `foodLine` locals from this block; Tasks 3–5 reintroduce them in the tabs that use them.

- [ ] **Step 6: Move the two Featured pins to the Animals builder**

`tests/park.test.ts:947-956` and `:959-966` call `dashboardPayload` expecting a Featured field and its thumbnail. Featured now lives on the Animals tab. **Do not delete these tests** — retarget them in Task 3, once `animalsPayload` exists. For now mark them skipped so the suite is green between commits:

```ts
  it.skip('names the featured dino and attaches its archetype art as the thumbnail', () => {
```

```ts
  it.skip('ships no files and no Featured field when nothing is featured', () => {
```

Add a comment above the first: `// Retargeted to animalsPayload in Task 3 — un-skip there.`

- [ ] **Step 7: Run the full suite**

Run: `npm test`

Expected: PASS, with two skipped. Any other failure is a real call site that needs updating — fix it rather than skipping it.

- [ ] **Step 8: Commit**

```bash
git add src/modules/park/embeds.ts src/modules/park/index.ts tests/park.test.ts tests/park-tabs.test.ts
git commit -m "Reduce the park dashboard to the Park tab

Cash, Rating and a compact attention marker, plus the park image and Collect.
Food, Attendance, Achievements, Legacy, Seasons, Featured and the lot list
move to their own tabs in the following commits. The attention marker is a
sum rather than the itemised breakdown so an escaping dino is never hidden
behind a click."
```

---

### Task 3: Animals tab payload

**Files:**
- Modify: `src/modules/park/embeds.ts`
- Test: `tests/park-tabs.test.ts`, `tests/park.test.ts`

**Interfaces:**
- Consumes: `tabRow` (Task 1).
- Produces:
  ```ts
  export function animalsPayload(
    user: User, dinoCount: number,
    opts?: { escaped?: number; atRisk?: number; mismatch?: number; foodLine?: string;
             featured?: Featured | null; visit?: boolean },
  ): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }
  ```

- [ ] **Step 1: Write the failing test**

Add to `tests/park-tabs.test.ts`:

```ts
import { animalsPayload } from '../src/modules/park/embeds.js';

describe('Animals tab', () => {
  it('itemises what the Park tab only summarised', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 9, { escaped: 1, atRisk: 3, mismatch: 2 });
    const v = fieldsOf(p).find((f) => f.name.includes('Needs attention'))!.value;
    expect(v).toContain('1 escaped');
    expect(v).toContain('3 at risk');
    expect(v).toContain('2 wrong habitat');
  });

  it('omits the attention field entirely when nothing is wrong', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 9, {});
    expect(fieldsOf(p).some((f) => f.name.includes('Needs attention'))).toBe(false);
  });

  it('carries the roster banner, and the featured dino art second', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, {
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
    });
    // Call order is upload order, and several tests across the suite pin files by name.
    expect(p.files!.map((f) => f.name)).toEqual(['dino_roster.webp', 'tank-herbivore.webp']);
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
  });

  it('drops the action buttons on a visited card but keeps the tab row', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, { visit: true });
    expect(JSON.stringify(p)).not.toContain('park:feedall');
    expect(p.components).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "Animals tab"`

Expected: FAIL — `does not provide an export named 'animalsPayload'`.

- [ ] **Step 3: Implement `animalsPayload`**

Add to `src/modules/park/embeds.ts`:

```ts
/**
 * The ANIMALS tab. The three attention counts share one toClockDinos pass in the caller —
 * they are free once it is paid for, which is why they live together rather than being
 * split across tabs.
 */
export function animalsPayload(
  user: User, dinoCount: number,
  opts: { escaped?: number; atRisk?: number; mismatch?: number; foodLine?: string;
          featured?: Featured | null; visit?: boolean } = {},
) {
  const embed = new EmbedBuilder()
    .setTitle(`🦕 ${user.parkName} — Animals`)
    .setColor(0x3ba55c)
    .addFields(
      { name: '🦕 Dinos', value: String(dinoCount), inline: true },
      { name: `${emojiTag('dw_food')} Food`, value: opts.foodLine ?? 'none — /shop food', inline: true },
    );
  if (opts.featured) {
    embed.addFields({ name: '🦖 Featured', value: opts.featured.name, inline: true });
  }
  const parts: string[] = [];
  if (opts.escaped) parts.push(`${emojiTag('dw_alert')} ${opts.escaped} escaped — /rescue`);
  if (opts.atRisk) parts.push(`${emojiTag('dw_hunger')} ${opts.atRisk} at risk`);
  if (opts.mismatch) parts.push(`⚠️ ${opts.mismatch} wrong habitat`);
  if (parts.length) {
    embed.addFields({ name: '⚠️ Needs attention', value: parts.join('\n') });
  }
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (!opts.visit) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`park:feedall:${user.discordId}`)
        .setLabel('🍖 Feed all').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`park:dinos:${user.discordId}:1`)
        .setLabel('📋 Full roster').setStyle(ButtonStyle.Secondary),
    ));
  }
  components.push(tabRow(user.discordId, 'animals', opts.visit));
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[];
  } = { embeds: [embed], components };
  // Two attach() calls, never a hand-assigned files array. Order is upload order and the
  // names differ (dino_roster.webp vs <archetype>-<diet>.webp), so neither can shadow the
  // other's attachment:// URL. dinoImage, not assetImage: a species with its own portrait
  // overrides the shared archetype art.
  attach(embed, payload, 'image', assetImage('banners', 'dino_roster'));
  attach(embed, payload, 'thumbnail',
    opts.featured ? dinoImage(opts.featured.speciesId, opts.featured.archetype, opts.featured.diet) : null);
  return payload;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts -t "Animals tab"`

Expected: PASS, four cases.

- [ ] **Step 5: Un-skip and retarget the two Featured pins**

In `tests/park.test.ts`, change both skipped tests to call `animalsPayload` and drop the `.skip`. The first becomes:

```ts
  it('names the featured dino and attaches its archetype art as the thumbnail', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, {
      featured: { name: 'Trixie', speciesId: 'triceratops', archetype: 'tank', diet: 'herbivore' },
    });
    expect(fieldsOf(p).find((f) => f.name === '🦖 Featured')!.value).toBe('Trixie');
    expect(p.embeds[0].toJSON().thumbnail?.url).toBe('attachment://tank-herbivore.webp');
    // Two files now: the roster banner plus the featured dino. Was 1 when this field
    // lived on the single dashboard card.
    expect(p.files).toHaveLength(2);
  });
```

The second becomes:

```ts
  it('ships only the roster banner and no Featured field when nothing is featured', () => {
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = animalsPayload(user, 1, {});
    expect(fieldsOf(p).some((f) => f.name === '🦖 Featured')).toBe(false);
    // attach() on a null ref is a total no-op, so the banner is the only entry — the
    // "never an empty array" distinction other test files pin still holds.
    expect(p.files).toHaveLength(1);
    expect(p.files![0].name).toBe('dino_roster.webp');
  });
```

Add the import: `import { animalsPayload } from '../src/modules/park/embeds.js';`

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS, zero skipped.

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/embeds.ts tests/park-tabs.test.ts tests/park.test.ts
git commit -m "Add the Animals tab

Itemises the escaped, at-risk and wrong-habitat counts the Park tab now only
summarises, and takes ownership of Food and the featured dino. The two
featured-dino assertions move here from the dashboard card."
```

---

### Task 4: Lots tab payload

**Files:**
- Modify: `src/modules/park/embeds.ts`
- Test: `tests/park-tabs.test.ts`

**Interfaces:**
- Consumes: `tabRow` (Task 1).
- Produces:
  ```ts
  export function lotsPayload(
    user: User, lots: Lot[], slots: number, opts?: { visit?: boolean },
  ): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }
  ```
  `slots` is `lotSlots(user.ratingHighWater)`, computed by the caller.

- [ ] **Step 1: Write the failing test**

```ts
import { lotsPayload } from '../src/modules/park/embeds.js';

describe('Lots tab', () => {
  it('lists each lot with its level and shows slot usage', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const lots = [
      { id: 1, userId: 'u1', type: 'paddock', kind: 'carnivore_paddock', name: 'Carnivore Paddock', level: 4 },
      { id: 2, userId: 'u1', type: 'facility', kind: 'gene_lab', name: 'Gene Lab', level: 2 },
    ] as never;
    const p = lotsPayload(user, lots, 6);
    const built = fieldsOf(p).find((f) => f.name.includes('Built'))!.value;
    expect(built).toContain('#1');
    expect(built).toContain('Carnivore Paddock');
    expect(built).toContain('lvl 4');
    expect(fieldsOf(p).find((f) => f.name.includes('Slots'))!.value).toBe('2 / 6 used');
  });

  it('tells an empty park what to do instead of rendering a blank field', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3);
    expect(fieldsOf(p).find((f) => f.name.includes('Built'))!.value).toContain('/build');
  });

  it('carries the lots banner', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = lotsPayload(user, [], 3);
    expect(p.files!.map((f) => f.name)).toEqual(['lots.webp']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "Lots tab"`

Expected: FAIL — no export named `lotsPayload`.

- [ ] **Step 3: Implement `lotsPayload`**

```ts
/**
 * The LOTS tab. Build and Upgrade arrive as select menus in a later PR; until then this
 * tab points at the existing slash commands rather than pretending to be actionable.
 */
export function lotsPayload(
  user: User, lots: Lot[], slots: number, opts: { visit?: boolean } = {},
) {
  const embed = new EmbedBuilder()
    .setTitle(`🏗️ ${user.parkName} — Lots`)
    .setColor(0x3ba55c)
    .addFields(
      { name: '🏗️ Built', value: lots.map((l) => {
        const e = emojiTag(LOT_EMOJI[l.kind] ?? '');
        return `#${l.id} ${e ? `${e} ` : ''}${l.name} (lvl ${l.level})`;
      }).join('\n') || 'Nothing built yet — `/build` to start.', inline: false },
      { name: 'Slots', value: `${lots.length} / ${slots} used`, inline: true },
    );
  if (!opts.visit) {
    embed.addFields({
      name: 'Building', value: 'Use `/build kind:` for a new lot and `/upgrade lot:` to level one up.',
      inline: false,
    });
  }
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[];
  } = { embeds: [embed], components: [tabRow(user.discordId, 'lots', opts.visit)] };
  attach(embed, payload, 'image', assetImage('banners', 'lots'));
  return payload;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts -t "Lots tab"`

Expected: the first two cases PASS. **The banner case FAILS** — `assets/images/banners/lots.webp` does not exist yet, and `assetImage` returns null for a missing file, so `attach` is a total no-op and `p.files` is `undefined`. That is correct behaviour, not a bug: absent art is never an error.

- [ ] **Step 5: Skip the banner assertion until Task 9 ships the asset**

```ts
  // Un-skip in Task 9, which adds assets/images/banners/lots.webp. assetImage returns
  // null for a missing file and attach() no-ops on null, so this cannot pass before then.
  it.skip('carries the lots banner', () => {
```

- [ ] **Step 6: Run the full suite**

Run: `npm test` — Expected: PASS, one skipped.

- [ ] **Step 7: Commit**

```bash
git add src/modules/park/embeds.ts tests/park-tabs.test.ts
git commit -m "Add the Lots tab

Lot list, level and slot usage. Build and Upgrade stay slash commands for
now; the select menus arrive with the router work."
```

---

### Task 5: Prestige tab payload

**Files:**
- Modify: `src/modules/park/embeds.ts`
- Test: `tests/park-tabs.test.ts`

**Interfaces:**
- Consumes: `tabRow` (Task 1).
- Produces:
  ```ts
  export function prestigePayload(
    user: User,
    opts?: { attendance?: number; earnedTiers?: number; legacyRank?: LegacyTier | null;
             seasonBadges?: { count: number; latest: number | null }; landmark?: LandmarkDef | null;
             visit?: boolean },
  ): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[] }
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { prestigePayload } from '../src/modules/park/embeds.js';
import { tierForPoints } from '../src/modules/park/ranks.js';

describe('Prestige tab', () => {
  it('gathers every standing number onto one screen', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = prestigePayload(user, {
      attendance: 18420, earnedTiers: 31, legacyRank: tierForPoints(120),
      seasonBadges: { count: 3, latest: 690 },
    });
    const names = fieldsOf(p).map((f) => f.name);
    expect(names.some((n) => n.includes('Attendance'))).toBe(true);
    expect(names.some((n) => n.includes('Achievements'))).toBe(true);
    expect(names.some((n) => n.includes('Legacy'))).toBe(true);
    expect(names.some((n) => n.includes('Seasons'))).toBe(true);
  });

  it('omits Achievements and Seasons at zero rather than printing a 0', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const p = prestigePayload(user, { earnedTiers: 0, seasonBadges: { count: 0, latest: null } });
    const names = fieldsOf(p).map((f) => f.name);
    expect(names.some((n) => n.includes('Achievements'))).toBe(false);
    expect(names.some((n) => n.includes('Seasons'))).toBe(false);
  });

  it('offers Landmark and Guests on your own card and neither on a visit', () => {
    const ctx = makeCtx();
    const user = getOrCreateUser(ctx, 'u1', 'Reg');
    const mine = JSON.stringify(prestigePayload(user, {}));
    expect(mine).toContain('park:goto:landmark');
    expect(mine).toContain('park:goto:guests');
    const theirs = JSON.stringify(prestigePayload(user, { visit: true }));
    expect(theirs).not.toContain('park:goto:');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "Prestige tab"`

Expected: FAIL — no export named `prestigePayload`.

- [ ] **Step 3: Implement `prestigePayload`**

```ts
/**
 * The PRESTIGE tab. Takes `legacyRank` as a VALUE — the caller decides whether to read it
 * with the pure `legacyRank()` or to latch the high-water with `bumpLegacyBest()`. This
 * builder must never call either: it renders other players' cards too.
 */
export function prestigePayload(
  user: User,
  opts: { attendance?: number; earnedTiers?: number; legacyRank?: LegacyTier | null;
          seasonBadges?: { count: number; latest: number | null }; landmark?: LandmarkDef | null;
          visit?: boolean } = {},
) {
  const embed = new EmbedBuilder()
    .setTitle(`🏛️ ${user.parkName} — Prestige`)
    .setColor(0xc9a227)
    .addFields(
      { name: `${emojiTag('dw_star')} Rating`, value: (user.parkRating / 100).toFixed(1), inline: true },
      { name: '🎡 Attendance', value: `${(opts.attendance ?? 0).toLocaleString()} / ${ATTENDANCE_MAX.toLocaleString()}`, inline: true },
    );
  const earnedTiers = opts.earnedTiers ?? 0;
  if (earnedTiers > 0) {
    embed.addFields({ name: '🏆 Achievements', value: `${earnedTiers} tier${earnedTiers === 1 ? '' : 's'} earned`, inline: true });
  }
  if (opts.legacyRank) {
    embed.addFields({ name: '🏛️ Legacy', value: `${opts.legacyRank.title} (rank ${opts.legacyRank.rank})`, inline: true });
  }
  if (opts.seasonBadges && opts.seasonBadges.count > 0) {
    const { count, latest } = opts.seasonBadges;
    embed.addFields({
      name: '🎖️ Seasons',
      value: `${count} badge${count === 1 ? '' : 's'}${latest === null ? '' : ` · latest Season ${seasonNumberOf(latest)}`}`,
      inline: true,
    });
  }
  embed.addFields({
    name: '🏛️ Landmark',
    value: opts.landmark ? `Tier ${opts.landmark.tier} — ${opts.landmark.name}` : 'None yet',
    inline: true,
  });
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (!opts.visit) {
    components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`park:goto:landmark:${user.discordId}`)
        .setLabel('🏛️ Landmark').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`park:goto:guests:${user.discordId}`)
        .setLabel('🎡 Guests').setStyle(ButtonStyle.Secondary),
    ));
  }
  components.push(tabRow(user.discordId, 'prestige', opts.visit));
  const payload: {
    embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[]; files?: AttachmentBuilder[];
  } = { embeds: [embed], components };
  attach(embed, payload, 'image', assetImage('banners', 'landmark'));
  return payload;
}
```

Add the import `import { landmarkFor } from '../../data/landmarks.js';` only if `LandmarkDef` is not already imported as a type in this file — it is (`import type { LandmarkDef } from '../../data/landmarks.js'`), so no new import is needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts -t "Prestige tab"`

Expected: PASS, three cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS, one skipped (the Lots banner from Task 4).

Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/park/embeds.ts tests/park-tabs.test.ts
git commit -m "Add the Prestige tab

Attendance, achievements, legacy rank, season badges and the landmark tier on
one screen. Takes legacyRank as a value so the builder never decides whether
to latch the high-water — it renders other players' cards too."
```

---

### Task 6: Tab dispatcher

**Files:**
- Modify: `src/modules/park/index.ts` (the `switch (action)` from the default-arm PR)
- Test: `tests/park-tabs.test.ts`

**Interfaces:**
- Consumes: all four payload builders (Tasks 2–5), `isParkTab` (Task 1).
- Produces: the `park:tab:<uid>:<tab>` handler. Behavioural contract later tasks rely on: **the Park tab defers with `deferUpdate()` then `editReply`s; the other three `i.update` directly; every one sends `attachments: []`.**

- [ ] **Step 1: Write the failing test**

```ts
import { fakeButton } from './harness.js';
import { parkModule } from '../src/modules/park/index.js';

const parkComp = () => parkModule.components.find((c) => c.prefix === 'park')!;

describe('tab dispatcher', () => {
  it('renders another tab in place, shedding the previous tab uploads', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:prestige', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { attachments: unknown[]; embeds: Array<{ toJSON(): { title: string } }> };
    // Without attachments: [] the outgoing tab's uploads survive as orphan cards.
    expect(sent.attachments).toEqual([]);
    expect(sent.embeds[0].toJSON().title).toContain('Prestige');
  });

  it('defers before rendering the Park tab, because renderPark can eat the whole window', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:park', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(b.deferOpts).toEqual([{ kind: 'update' }]);
  });

  it('refuses a stranger driving somebody else own-park tabs', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const b = fakeButton({ customId: 'park:tab:u1:lots', user: 'u2' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(JSON.stringify(b.replies[0])).toContain('Not your park');
  });

  it('absorbs an unknown tab name rather than rendering a default screen', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:map', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(b.deferOpts).toEqual([{ kind: 'update' }]);
    expect(b.replies).toEqual([]);
  });

  // ADDED DURING EXECUTION — recovers coverage this plan would otherwise have lost.
  // Task 2 deleted the /park view `foodLine` local and Task 3's animalsPayload takes
  // `foodLine?: string` as an opaque value, so between them nothing tested the
  // DB-to-string formatting any more: the food-line test retargeted in Task 3 now only
  // asserts that the Food field echoes a hardcoded string. This task is where that
  // formatting is reintroduced (the getFoodInventory / FOODS / foodEmoji join in
  // renderTab's animals branch), so this is where it has to be tested again.
  it('formats the food line from real inventory rows, not a passed-in string', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    ctx.economy.addFood('u1', 'fern_bale', 10);
    ctx.economy.addFood('u1', 'prime_cut', 2);
    const b = fakeButton({ customId: 'park:tab:u1:animals', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const food = (sent.embeds[0].toJSON().fields ?? []).find((f) => f.name.includes('Food'))!.value;
    // Both items present, joined — the grouping and separator are the thing under test.
    expect(food).toContain('×10');
    expect(food).toContain('×2');
    expect(food).toContain(' · ');
  });

  it('falls back to the shop hint when the player holds no food at all', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:tab:u1:animals', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { embeds: Array<{ toJSON(): { fields?: Array<{ name: string; value: string }> } }> };
    const food = (sent.embeds[0].toJSON().fields ?? []).find((f) => f.name.includes('Food'))!.value;
    expect(food).toContain('/shop food');
  });
});
```

**Note on the two food-line cases above:** `getOrCreateUser` grants `STARTER_FOOD`, so the
"no food at all" case may need that inventory cleared first — check what a fresh user
actually holds and adjust the fixture rather than the assertion. Confirm the real helper
name for granting food (`ctx.economy.addFood` is the assumed name) against
`src/core/economy.ts` before writing these; use whatever the codebase actually exposes.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "tab dispatcher"`

Expected: FAIL. With the default arm merged, `park:tab:…` currently falls to `default` and only defers, so the first and third cases fail.

- [ ] **Step 3: Add the `tab` case**

In `src/modules/park/index.ts`, inside the `switch (action)`, before `default`:

```ts
          case 'tab': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            const tab = parts[3];
            // Client-supplied: validated against the real union, never cast. An
            // unrecognised name is absorbed silently rather than falling through to a
            // default screen, which would report success for a tab nobody implemented.
            if (!isParkTab(tab)) { await i.deferUpdate(); return; }
            await renderTab(ctx, i, i.user.id, tab, false);
            return;
          }
```

Then add the shared renderer at module scope in the same file:

```ts
/**
 * Renders one tab onto the message that was clicked.
 *
 * settleEscapes runs ONCE here rather than in each builder: it is write-bearing, and
 * buildParkSnapshot settles again internally, so a per-builder call would multiply a
 * mutation across a navigation click.
 *
 * The Park tab defers first. renderPark's own RENDER_TIMEOUT_MS is 3000 — Discord's entire
 * initial-response window — and renders serialize process-wide, so rendering before
 * acknowledging loses the interaction to 10062 and shows "This interaction failed".
 * deferUpdate, never deferReply: a tab advances ONE message rather than accumulating one
 * per click, the park:tour reasoning exactly.
 *
 * Every branch sends attachments: [] — a tab switch is a different-banner render, and
 * without it the outgoing tab's uploads survive alongside the incoming one as orphan
 * attachment cards. This is the opposite of the omit-idiom landmarkPayload uses.
 */
async function renderTab(
  ctx: Ctx, i: ButtonInteraction, ownerId: string, tab: ParkTab, visit: boolean,
): Promise<void> {
  settleEscapes(ctx, ownerId);
  const user = ctx.db.select().from(schema.users)
    .where(eq(schema.users.discordId, ownerId)).get()!;
  const lots = ctx.db.select().from(schema.lots).where(eq(schema.lots.userId, ownerId)).all();
  const dinos = ctx.db.select().from(schema.dinos).where(eq(schema.dinos.userId, ownerId)).all();
  if (tab === 'park') {
    await i.deferUpdate();
    const { clockDinos } = toClockDinos(ctx, ownerId);
    const nowMs = ctx.now();
    const escaped = dinos.filter((d) => d.escapedAt !== null).length;
    const atRisk = clockDinos.filter((c) => {
      if (c.escapedAt !== null) return false;
      const e = escapeAt(c);
      return e !== null && e - nowMs <= ESCAPE_WARN_MS;
    }).length;
    const mismatch = clockDinos.filter((c) =>
      c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet).length;
    const pending = visit ? 0 : pendingIncome(ctx, ownerId);
    const capped = pending > 0 && ctx.now() - user.lastCollectAt >= capHours(lots) * 3_600_000;
    const base = dashboardPayload(user, pending, {
      attention: escaped + atRisk + mismatch, capped, now: nowMs,
      motto: user.motto, dinoCount: dinos.length, visit,
    });
    let png: Buffer | undefined;
    try { png = await renderPark(buildParkSnapshot(ctx, ownerId)); } catch { png = undefined; }
    await i.editReply({ ...(png ? withParkImage(base, png) : base), attachments: [] });
    return;
  }
  if (tab === 'animals') {
    const { clockDinos } = toClockDinos(ctx, ownerId);
    const nowMs = ctx.now();
    const inv = ctx.economy.getFoodInventory(ownerId);
    const foodLine = (Object.entries(inv) as Array<[FoodId, number]>)
      .map(([id, q]) => `${foodEmoji(id)}${FOODS[id].name} ×${q}`).join(' · ') || 'none — /shop food';
    await i.update({
      ...animalsPayload(user, dinos.length, {
        escaped: dinos.filter((d) => d.escapedAt !== null).length,
        atRisk: clockDinos.filter((c) => {
          if (c.escapedAt !== null) return false;
          const e = escapeAt(c);
          return e !== null && e - nowMs <= ESCAPE_WARN_MS;
        }).length,
        mismatch: clockDinos.filter((c) =>
          c.paddock !== null && c.escapedAt === null && c.paddock.diet !== c.species.diet).length,
        foodLine, featured: featuredFor(ctx, user), visit,
      }),
      attachments: [],
    });
    return;
  }
  if (tab === 'lots') {
    await i.update({ ...lotsPayload(user, lots, lotSlots(user.ratingHighWater), { visit }), attachments: [] });
    return;
  }
  // prestige — legacyRank (pure), never bumpLegacyBest: the high-water latches on the
  // Park tab, which every /park view renders first, so a navigation click never writes.
  await i.update({
    ...prestigePayload(user, {
      attendance: attendanceOf(ctx, ownerId).attendance,
      earnedTiers: earnedTierCount(ctx, ownerId),
      legacyRank: legacyRank(ctx, ownerId),
      seasonBadges: seasonBadges(ctx, ownerId),
      landmark: landmarkFor(user.landmarkTier),
      visit,
    }),
    attachments: [],
  });
}
```

Add these imports to `src/modules/park/index.ts`:

```ts
import { dashboardPayload, animalsPayload, lotsPayload, prestigePayload, withParkImage, landmarkPayload, isParkTab, type ParkTab } from './embeds.js';
import { legacyRank } from './ranks.js';
import { lotSlots } from '../../data/progression.js';
import type { ButtonInteraction } from 'discord.js';
```

`bumpLegacyBest` and `tierForPoints` remain imported for the `/park view` command path.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts -t "tab dispatcher"`

Expected: PASS, four cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS, one skipped.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/park/index.ts tests/park-tabs.test.ts
git commit -m "Dispatch park view tabs in place

Owner-checked, settling escapes once per interaction rather than once per
builder. The Park tab defers before rendering because renderPark can consume
Discord's entire three-second window on its own; the other three update
directly. Every branch sends attachments: [] so the outgoing tab's uploads
cannot survive as orphan cards."
```

---

### Task 7: Action buttons

**Files:**
- Modify: `src/modules/park/index.ts`
- Test: `tests/park-tabs.test.ts`

**Interfaces:**
- Consumes: `renderTab` (Task 6), `dinoListPayload` (already module-private in this file).
- Produces: handlers for `park:feedall:<uid>` and `park:goto:<target>:<uid>`.

- [ ] **Step 1: Write the failing test**

```ts
describe('tab action buttons', () => {
  it('feeds and stays on the Animals tab rather than collapsing the card', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:feedall:u1', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { content: string; embeds: Array<{ toJSON(): { title: string } }> };
    expect(sent.content).toContain('🍖');
    // The tab card survives — alert:feedall collapses to a bare line because a DM has
    // nothing to return to; this one does not.
    expect(sent.embeds[0].toJSON().title).toContain('Animals');
  });

  it('opens a routed surface ephemerally so the tab card is left intact', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    const b = fakeButton({ customId: 'park:goto:landmark:u1', user: 'u1' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    const sent = b.replies[0] as { flags?: number };
    expect(sent.flags).toBe(MessageFlags.Ephemeral);
    expect(b.deferOpts).toEqual([]);
  });

  it('refuses a stranger feeding somebody else park', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const b = fakeButton({ customId: 'park:feedall:u1', user: 'u2' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(JSON.stringify(b.replies[0])).toContain('Not your park');
  });
});
```

Add `import { MessageFlags } from 'discord.js';` to the test file.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "tab action buttons"`

Expected: FAIL — both ids fall to the default arm and only defer.

- [ ] **Step 3: Add both cases**

Inside the `switch (action)`, before `default`:

```ts
          case 'feedall': {
            if (i.user.id !== uid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            settleEscapes(ctx, i.user.id);
            const { fed, skipped } = feedAll(ctx, i.user.id);
            const report = feedSkipReport(ctx, i.user.id, skipped);
            const head = fed.length === 0
              ? (skipped.length > 0 ? '🍖 Nothing could be fed.' : '🍖 Nothing to feed — every dino is already full.')
              : `🍖 Fed **${fed.length}** ${fed.length === 1 ? 'dino' : 'dinos'}.`;
            // Re-renders the Animals tab beneath the result line rather than collapsing to
            // a bare confirmation: alert:feedall collapses because an alert DM has nothing
            // to return to, but this card is the screen the player is standing on.
            await renderTab(ctx, i, i.user.id, 'animals', false, report ? `${head}\n\n${report}` : head);
            return;
          }
          case 'goto': {
            // park:goto:<target>:<uid> — four parts, so the owner sits at index 3.
            const [, , target, gotoUid] = parts;
            if (i.user.id !== gotoUid) {
              await i.reply({ content: 'Not your park.', flags: MessageFlags.Ephemeral });
              return;
            }
            // Ephemeral, never i.update: a routed payload mints its own components under a
            // foreign prefix, and those handlers re-render THEIR message with no tab row —
            // so updating in place would strand the player one click from losing navigation.
            const fresh = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, i.user.id)).get()!;
            if (target === 'landmark') {
              await i.reply({
                ...landmarkPayload(fresh, landmarkFor(fresh.landmarkTier), landmarkFor(fresh.landmarkTier + 1)),
                flags: MessageFlags.Ephemeral,
              });
              return;
            }
            if (target === 'guests') {
              await i.reply({ ...guestsPayload(ctx, i.user.id), flags: MessageFlags.Ephemeral });
              return;
            }
            await i.deferUpdate();
            return;
          }
```

Change `renderTab`'s signature to accept the optional result line:

```ts
async function renderTab(
  ctx: Ctx, i: ButtonInteraction, ownerId: string, tab: ParkTab, visit: boolean, content?: string,
): Promise<void> {
```

and thread `content` into each send, e.g. for the animals branch:

```ts
    await i.update({ ...(content ? { content } : {}), ...animalsPayload(/* … */), attachments: [] });
```

Do the same for the `lots`, `prestige` and `park` sends. Spreading `content` **first** matters: the payload builders never set `content`, so order is cosmetic today, but a later builder that does must win over a stale caller value.

Add the import for the guests builder:

```ts
import { guestsPayload } from '../guests/embeds.js';
```

This import is safe: nothing in `src/` imports `park/index.ts` except `src/core/module-list.ts`, so it cannot close a cycle. **Do not add this import to `park/embeds.ts` or `park/visit.ts`** — those are reachable from `leaderboards` and would cycle.

Confirm the exact exported name and signature of the guests view builder before writing the call:

Run: `grep -n "^export function" src/modules/guests/embeds.ts`

Use whichever function builds the `/guests view` payload, with the arguments its signature actually requires.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/park-tabs.test.ts -t "tab action buttons"`

Expected: PASS, three cases.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS, one skipped.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/modules/park/index.ts tests/park-tabs.test.ts
git commit -m "Add the tab action buttons

Feed all re-renders the Animals tab under its result line rather than
collapsing the card. Landmark and Guests open ephemerally, because a routed
payload mints components under a foreign prefix whose handlers re-render
their own message with no tab row."
```

---

### Task 8: Visited park tabs

**Files:**
- Modify: `src/modules/park/visit.ts`, `src/modules/park/index.ts`
- Test: `tests/park-tabs.test.ts`, `tests/visit.test.ts`

**Interfaces:**
- Consumes: `renderTab` (Tasks 6–7), the four builders' `visit` option.
- Produces: the `park:vtab:<targetId>:<tab>` handler; `visitPayload` returns the Park tab with `visit: true`.

- [ ] **Step 1: Write the failing test**

```ts
describe('visited park tabs', () => {
  it('lets anyone drive a visited card — the id is a target, not an owner', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    const b = fakeButton({ customId: 'park:vtab:u1:lots', user: 'u2' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(JSON.stringify(b.replies[0])).not.toContain('Not your park');
    expect((b.replies[0] as { embeds: Array<{ toJSON(): { title: string } }> })
      .embeds[0].toJSON().title).toContain('Lots');
  });

  it('never mints a Collect or Feed all button on a visited card', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u1', 'Reg');
    getOrCreateUser(ctx, 'u2', 'Other');
    for (const tab of ['park', 'animals', 'lots', 'prestige']) {
      const b = fakeButton({ customId: `park:vtab:u1:${tab}`, user: 'u2' });
      await parkComp().execute(ctx, b.asInteraction() as never);
      const json = JSON.stringify(b.replies[0]);
      expect(json, tab).not.toContain('park:collect');
      expect(json, tab).not.toContain('park:feedall');
      expect(json, tab).not.toContain('park:goto:');
    }
  });

  it('answers a visit to a player with no park without acknowledging publicly', async () => {
    const ctx = makeCtx();
    getOrCreateUser(ctx, 'u2', 'Other');
    const b = fakeButton({ customId: 'park:vtab:nobody:park', user: 'u2' });
    await parkComp().execute(ctx, b.asInteraction() as never);
    expect(JSON.stringify(b.replies[0])).toContain('no park yet');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/park-tabs.test.ts -t "visited park tabs"`

Expected: FAIL — `vtab` falls to the default arm.

- [ ] **Step 3: Add the `vtab` case**

```ts
          case 'vtab': {
            // NO owner check, deliberately: `uid` here is the TARGET park, not an owner,
            // exactly like park:tour. An ownership check would make visiting work only for
            // the player whose park happens to be on screen.
            const tab = parts[3];
            if (!isParkTab(tab)) { await i.deferUpdate(); return; }
            // The existence check stays AHEAD of any acknowledgement so "no park yet" can
            // still be ephemeral — the /park view user: ordering exactly.
            const exists = ctx.db.select().from(schema.users)
              .where(eq(schema.users.discordId, uid)).get();
            if (!exists) {
              await i.reply({ content: 'That player has no park yet.', flags: MessageFlags.Ephemeral });
              return;
            }
            await renderTab(ctx, i, uid, tab, true);
            return;
          }
```

- [ ] **Step 4: Point `visitPayload` at the Park tab builder**

In `src/modules/park/visit.ts`, replace the `dashboardPayload` call and the hand-built `components` with:

```ts
  const built = dashboardPayload(user, 0, {
    motto: user.motto, now: ctx.now(), dinoCount: dinos.length,
    attention: escaped, visit: true,
  });
  const payload: VisitPayload = { embeds: built.embeds, components: built.components };
  if (built.files) payload.files = built.files;
```

The old comment explaining why `components` was dropped no longer applies — `visit: true` means the builder never mints `park:collect` in the first place, and the tab row must survive. Replace that comment with:

```ts
  // components come straight from the builder now: `visit: true` suppresses park:collect
  // at the source rather than filtering it out here, and the tab row must survive so a
  // visitor can navigate. The old hand-built `components: []` would strip both.
```

Keep the `Next park ▶` button push exactly as it is — it appends a second row beneath the tab row.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run tests/park-tabs.test.ts tests/visit.test.ts`

Expected: PASS. If `tests/visit.test.ts` asserts `components` has length 1, update it to expect the tab row plus `Next park` and note in the test why.

- [ ] **Step 6: Extend the real-payload sweep to cover every tab**

`tests/router.test.ts`'s "every live button surface still routes" sweep currently harvests one park surface. The tabs mint four new button sets — three tab rows plus the action rows — and none is covered. Add them to the `surfaces` array beside the existing park entry:

```ts
      ['/park view Animals tab', idsOf(animalsPayload(user, 3, {}).components)],
      ['/park view Lots tab', idsOf(lotsPayload(user, [], 3).components)],
      ['/park view Prestige tab', idsOf(prestigePayload(user, {}).components)],
      ['/park view visited card', idsOf(dashboardPayload(user, 0, { visit: true }).components)],
```

Import the three new builders at the top of `tests/router.test.ts` alongside the existing `dashboardPayload` import.

The sweep already asserts `ids.length > 0` per surface, so a builder that silently stops minting buttons fails loudly rather than passing vacuously. `PREFIXES` already contains `park`, so no change is needed there.

Run: `npx vitest run tests/router.test.ts`

Expected: PASS. Every `park:tab:`, `park:vtab:`, `park:feedall:` and `park:goto:` id now routes through the real guard.

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test` — Expected: PASS, one skipped.
Run: `npm run typecheck` — Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/modules/park/visit.ts src/modules/park/index.ts tests/park-tabs.test.ts tests/visit.test.ts tests/router.test.ts
git commit -m "Give visited parks the same tabs, read-only

The vtab family carries a target rather than an owner and is deliberately not
owner-checked, the park:tour precedent. visit: true suppresses Collect, Feed
all and the routed buttons at the source instead of filtering them out after
the fact, which is what let the old code drop the tab row too."
```

---

### Task 9: The Lots banner asset

**Files:**
- Create: `assets/images/banners/lots.webp`
- Modify: `docs/assets/prompts.md`, `tests/park-tabs.test.ts`

**Interfaces:**
- Consumes: `lotsPayload` (Task 4), which already calls `assetImage('banners', 'lots')`.
- Produces: the asset that un-skips Task 4's banner assertion.

- [ ] **Step 1: Generate the source image**

Produce a 1536×1024 banner in the established style of the existing banner family — a wide establishing shot of a park under construction: fenced enclosure plots, scaffolding, a half-built visitor structure, warm daylight, no text, no logos, no people in focus. Match the palette and painterly treatment of `assets/images/banners/landmark.webp` and `assets/images/banners/guests.webp`.

- [ ] **Step 2: Fit it to the banner contract**

```bash
node scripts/fit-art.mjs banner <source-image> assets/images/banners/lots.webp
```

- [ ] **Step 3: Verify the format and dimensions**

Run: `npx vitest run tests/images.test.ts`

Expected: PASS. That suite enforces WebP for everything under `assets/images/` and 1536×1024 for banners; a wrong format or size fails there rather than at runtime.

- [ ] **Step 4: Un-skip the banner assertion**

In `tests/park-tabs.test.ts`, remove `.skip` and the "Un-skip in Task 9" comment from the `carries the lots banner` case.

Run: `npx vitest run tests/park-tabs.test.ts -t "carries the lots banner"`

Expected: PASS.

- [ ] **Step 4b: Empty the pending-banner allowlist**

**ADDED DURING EXECUTION — this step did not exist when the plan was written, and skipping it silently re-opens a machine gate.**

Task 4 wires `assetImage('banners', 'lots')` before this asset exists. That tripped a guard the plan's pre-flight never examined: `tests/images.test.ts` scrapes `src/` for banner references and asserts each has a committed, correctly-sized file. Task 4 added a narrowly-scoped `PENDING_BANNERS` allowlist to excuse `'lots'` from the exists-and-dimensions assertions only — the scrape itself, the "found at least one" sanity check, and the reverse "every committed file is referenced" check were all left intact.

Now that the asset exists, delete the `'lots'` entry. The set must end up **empty**, and the `PENDING_BANNERS` declaration and both its use sites should go with it — an empty allowlist left in place is an invitation to add the next entry.

Run: `npx vitest run tests/images.test.ts`

Expected: PASS, with `lots.webp` now covered by the same exists-and-1536×1024 assertions every other banner gets.

**This task is deliberately executed immediately after Task 4, out of numeric order**, so the allowlist lives for exactly one task rather than six. Tasks 5–8 renumber nothing; they simply run after this one.

- [ ] **Step 5: Record the prompt**

Add a row to `docs/assets/prompts.md` in the banners section, matching the surrounding format: the file name, the prompt used, and the `fit-art.mjs banner` invocation.

- [ ] **Step 6: Run the full suite**

Run: `npm test` — Expected: PASS, zero skipped.

- [ ] **Step 7: Commit**

```bash
git add assets/images/banners/lots.webp docs/assets/prompts.md tests/park-tabs.test.ts
git commit -m "Add the Lots tab banner"
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/commands.md`, `docs/gameplay.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Update the command reference**

In `docs/commands.md`, find the `/park view` entry and describe the four tabs, that the card is navigated in place, and that a visited park is read-only.

- [ ] **Step 2: Update the gameplay guide**

In `docs/gameplay.md`, find the park view section and describe what lives on each tab. State explicitly that an escaping dino is summarised on the Park tab and itemised on Animals, so a reader knows where to look.

- [ ] **Step 3: Add the repo conventions**

Append to `CLAUDE.md`:

```markdown
- `/park view` renders one of four tabs — `park | animals | lots | prestige`
  (`ParkTab`, `src/modules/park/embeds.ts`) — swapped in place. `dashboardPayload` keeps
  its name and IS the Park tab; `animalsPayload`, `lotsPayload` and `prestigePayload` are
  the others. Two customId families: `park:tab:<uid>:<tab>` is owner-checked, and
  `park:vtab:<targetId>:<tab>` carries a TARGET and deliberately is not — the `park:tour`
  precedent. Never merge them into one shape with a flag.
  **Every tab switch sends an explicit `attachments: []`.** This is the OPPOSITE of the
  omit-idiom `landmarkPayload` and the guests view use: those re-send an identical
  attachment set, where a tab switch is a different-banner render, and without the key the
  outgoing tab's uploads (worst case `park.png` plus a featured-dino thumbnail) survive as
  orphan attachment cards under the new embed.
  The Park tab `deferUpdate()`s BEFORE rendering and then `editReply`s — `renderPark`'s
  `RENDER_TIMEOUT_MS` is 3000, Discord's whole initial-response window, and renders
  serialize process-wide. The other three tabs are synchronous and `i.update` directly.
  `settleEscapes` runs ONCE per interaction in `renderTab`, never per builder: it is
  write-bearing and `buildParkSnapshot` settles again internally.
  `bumpLegacyBest` runs on the Park tab only; every other tab and the whole visit path use
  the pure `legacyRank`, so a navigation click never mutates a row.
  **Collect must stay the first button of the first row** — `tests/park.test.ts:205-216`
  indexes `components[0].toJSON().components[0]` positionally.
  Routed surfaces (`park:goto:landmark`, `park:goto:guests`) reply EPHEMERALLY and never
  `i.update`: a routed payload mints components under a foreign prefix, and those handlers
  re-render their own message with no tab row, so updating in place would strand the
  player one click from losing navigation.
  Tabs are a UI win, not a performance win: `/park view` is ~31 `SELECT`s against a schema
  with exactly one index, so a tab switch re-pays the same unindexed scans. `user_id`
  indexes on `lots`/`dinos`/`attractions` are the higher-leverage change and were left out
  of this work deliberately.
```

- [ ] **Step 4: Verify the help-topic scrape still passes**

Run: `npx vitest run tests/help.test.ts`

Expected: PASS. No `/park` subcommand was added, so `HELP_TOPICS.park.body` needs no new line — but the scrape is the gate that would catch it if one had been.

- [ ] **Step 5: Commit**

```bash
git add docs/commands.md docs/gameplay.md CLAUDE.md
git commit -m "Document the park view tabs"
```

---

## Verification before opening the PR

- [ ] `npm test` — full suite green, zero skipped
- [ ] `npm run typecheck` — exit 0
- [ ] `npm run build` — exit 0
- [ ] `npm run test:live` — the gallery renders all four tabs; check by eye that each banner appears and no tab shows an orphan attachment card
- [ ] No `deploy-commands` run — confirm by checking `git diff main --stat` shows no change to any `SlashCommandBuilder`

## Self-Review

**Spec coverage:** Task 1 covers spec §2's customId shapes; Tasks 2–5 cover §1's tab table, the compact alert marker and the free header strip (§2.4); Task 6 covers §2.1's dispatcher, §2.2's defer-before-render and §2.3's attachments rule, plus §5's `settleEscapes` and `bumpLegacyBest` decisions; Task 7 covers §1's routed-surfaces-are-ephemeral ruling; Task 8 covers the visit treatment; Task 9 covers §8; Task 10 covers §9. Spec §3 (select menus), §6's `deploy-commands` exclusion and §7's `fakeSelect` work are **out of scope for this PR** and belong to plans 3 and 4. Spec §4 (router hooks) needs no code — the accepted behaviour is unchanged.

**Placeholder scan:** Task 7 Step 3 instructs a `grep` for the guests builder's exact signature rather than quoting one. That is deliberate: quoting a signature I have not read would be a fabricated type, which is worse than an instruction to read it. Every other code step shows complete code. Task 9 Step 1 describes an image to generate rather than providing one, which is inherent to an art task.

**Type consistency:** `dashboardPayload(user, pending, opts)` is used with that shape in Tasks 2, 6 and 8. `animalsPayload(user, dinoCount, opts)` in Tasks 3, 6 and in the retargeted `park.test.ts` pins. `lotsPayload(user, lots, slots, opts)` in Tasks 4 and 6. `prestigePayload(user, opts)` in Tasks 5 and 6. `renderTab` gains its sixth parameter `content?: string` in Task 7 and every call site in Task 6 keeps working because it is optional. `tabRow(id, active, visit?)` is consistent across Tasks 1–5.
