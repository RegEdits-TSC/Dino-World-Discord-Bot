import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeCtx, fakeButton, fakeCommand, testRegistry } from './harness.js';
import { routeInteraction } from '../src/core/router.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { startExpedition, activeExpedition } from '../src/modules/expeditions/service.js';

const DAY = 86_400_000;

/** Every custom_id on a payload's action rows, read out of the REAL builder JSON.
 *  Builder JSON is snake_case: `custom_id`, never `customId`.
 *  `?.components ?? []` on BOTH counts: a REFUSAL reply is `{ content, flags }` with no
 *  components key at all, and an unrouted or deferred click leaves `replies[0]` undefined
 *  entirely. The helper must answer "no ids" in both cases rather than throwing, or every
 *  refusal case below dies here instead of asserting what it came to assert — and every
 *  red step that predicts an empty list would report a TypeError instead. */
type MintedRows = { components?: ReadonlyArray<{ toJSON(): unknown }> } | undefined;
function mintedIds(reply: unknown): string[] {
  const rows = (reply as MintedRows)?.components ?? [];
  return rows
    .flatMap((r) => (r.toJSON() as { components: Array<{ custom_id?: string }> }).components)
    .map((c) => c.custom_id)
    .filter((id): id is string => typeof id === 'string');
}

/** The rendered label of one minted button, for whole-string assertions. */
function labelOf(reply: unknown, customId: string): string {
  const rows = (reply as MintedRows)?.components ?? [];
  return rows
    .flatMap((r) => (r.toJSON() as { components: Array<{ custom_id?: string; label?: string }> }).components)
    .find((c) => c.custom_id === customId)!.label!;
}

const cashOf = (c: ReturnType<typeof makeCtx>, id: string): number =>
  c.db.select().from(schema.users).where(eq(schema.users.discordId, id)).get()!.cash;

/** A player who can afford several digs. users.cash defaults to 500, so this leaves 50,500. */
function seedDigger(c: ReturnType<typeof makeCtx>, id = 'u1'): void {
  getOrCreateUser(c, id, 'Reg');
  c.economy.apply(id, { cash: 50_000 }, 'seed', c.now());
}

/** Dispatch to coastal_dig and advance to its return. coastal_dig's durationMs IS 15 minutes
 *  and claimExpedition refuses only on `returnsAt > now`, so landing exactly on it counts as
 *  returned — the same idiom tests/alert-buttons.test.ts already uses. 15 minutes never
 *  crosses a UTC midnight from the day starts these tests use, so the world event cannot
 *  move underneath a fixture. */
function digAndReturn(c: ReturnType<typeof makeCtx>, id = 'u1'): void {
  startExpedition(c, id, 'coastal_dig', null);
  c.setNow(c.now() + 15 * 60_000);
}

describe('Dig again — the button', () => {
  it('/expedition claim mints the Dig again button carrying the owner and the site', async () => {
    const ctx = makeCtx();
    seedDigger(ctx);
    digAndReturn(ctx);
    const i = fakeCommand({ name: 'expedition', sub: 'claim', user: 'u1' });
    await routeInteraction(ctx, testRegistry, i.asInteraction());
    // toContain, never a whole-list toEqual: Tasks G7-B and G4-D each add a second control to
    // this same array, and the ONE whole-list assertion over this surface lives in Task 29 (G8-A)'s
    // GRAPH so a deletion is a single findable failure rather than four.
    expect(mintedIds(i.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(labelOf(i.replies[0], 'exp:again:u1:coastal_dig')).toBe('🧭 Dig again');
  });

  it("the exp:claim button's own update mints it too, so both claim surfaces agree", async () => {
    const ctx = makeCtx();
    seedDigger(ctx);
    digAndReturn(ctx);
    const b = fakeButton({ customId: 'exp:claim:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(mintedIds(b.replies[0])).toContain('exp:again:u1:coastal_dig');
    expect(labelOf(b.replies[0], 'exp:again:u1:coastal_dig')).toBe('🧭 Dig again');
  });

  it('an unrecognised exp action still acknowledges rather than painting "This interaction failed"', async () => {
    // Already true today, and pinned here because Task 20 (G7-B) restructures this handler and must
    // keep it true: the unknown-action arm stays FIRST, ahead of the owner check. That ordering
    // is also pinned by tests/alert-buttons.test.ts's 'exp defers before the owner check on an
    // unknown action, even with a mismatched uid'.
    const ctx = makeCtx();
    seedDigger(ctx);
    const b = fakeButton({ customId: 'exp:whatever:u1', user: 'u1' });
    await routeInteraction(ctx, testRegistry, b.asInteraction());
    expect(b.replies).toHaveLength(0);
    expect(b.deferOpts).toHaveLength(1);
    expect(b.deferOpts[0]).toMatchObject({ kind: 'update' });
    expect(activeExpedition(ctx, 'u1')).toBeUndefined();
  });
});
