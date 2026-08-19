import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import { makeCtx, fakeCommand, fakeButton } from './harness.js';
import { schema } from '../src/core/db/index.js';
import { getOrCreateUser } from '../src/modules/park/service.js';
import { feedAll, feedDino, feedSkipReport, CareError } from '../src/modules/care/service.js';
import { renameDino } from '../src/modules/park/dinos.js';
import { careModule } from '../src/modules/care/index.js';
import { parkModule } from '../src/modules/park/index.js';

const H = 3_600_000;
let ctx: ReturnType<typeof makeCtx>;
beforeEach(() => { ctx = makeCtx(); getOrCreateUser(ctx, 'u1', 'Reg'); });

const clearFood = () =>
  ctx.db.delete(schema.foodInventory).where(eq(schema.foodInventory.userId, 'u1')).run();
const give = (foodId: string, qty: number) =>
  ctx.db.insert(schema.foodInventory).values({ userId: 'u1', foodId, qty }).run();
const addDino = (over: Record<string, unknown> = {}) =>
  ctx.db.insert(schema.dinos)
    .values({ userId: 'u1', speciesId: 'triceratops', hunger: 100, lastFedAt: 0, hatchedAt: 0, ...over })
    .returning().get();
const alertComp = () => parkModule.components.find((c) => c.prefix === 'alert')!;
const feedCmd = () => careModule.commands.find((c) => c.data.name === 'feed')!;
const embedText = (r: unknown) => JSON.stringify(r);

describe('feedAll skip records', () => {
  it('names the dino, its diet and its exact cost instead of only an id', () => {
    clearFood();
    const rex = addDino({ speciesId: 'tyrannosaurus', nickname: 'Rexy' });   // legendary carnivore, 80
    ctx.setNow(48 * H);
    const { fed, skipped } = feedAll(ctx, 'u1');
    expect(fed).toHaveLength(0);
    expect(skipped).toEqual([{ id: rex.id, name: 'Rexy', diet: 'carnivore', cost: 80 }]);
  });

  it('falls back to the species name when the dino has no nickname', () => {
    clearFood();
    const d = addDino();                                                     // common herbivore, 5
    ctx.setNow(48 * H);
    const { skipped } = feedAll(ctx, 'u1');
    expect(skipped).toEqual([{ id: d.id, name: 'Triceratops', diet: 'herbivore', cost: 5 }]);
  });

  it('records a skip caused by partial stock, not just an empty pantry', () => {
    clearFood(); give('fish', 12);                     // 12 Fish, legendary carnivore needs 80
    const rex = addDino({ speciesId: 'tyrannosaurus' });
    ctx.setNow(48 * H);
    const { skipped } = feedAll(ctx, 'u1');
    expect(skipped).toEqual([{ id: rex.id, name: 'Tyrannosaurus', diet: 'carnivore', cost: 80 }]);
    expect(ctx.economy.getFoodInventory('u1').fish).toBe(12);   // untouched
  });
});

describe('feedSkipReport', () => {
  it('is empty when nothing was skipped', () => {
    expect(feedSkipReport(ctx, 'u1', [])).toBe('');
  });

  it('groups by diet, totals the need, and names the stock actually held', () => {
    clearFood(); give('fish', 12);
    addDino({ speciesId: 'tyrannosaurus', nickname: 'Rexy' });     // carnivore 80
    addDino({ speciesId: 'brachiosaurus', nickname: 'Bruno' });    // herbivore 40 (epic)
    ctx.setNow(48 * H);
    const { skipped } = feedAll(ctx, 'u1');
    const report = feedSkipReport(ctx, 'u1', skipped);
    expect(report).toContain('2 skipped');
    expect(report).toContain('Carnivore');
    expect(report).toContain('80');                       // the carnivore total
    expect(report).toContain('12 Fish');                  // stock they really hold
    expect(report).toContain('Rexy');
    expect(report).toContain('Herbivore');
    expect(report).toContain('40');
    expect(report).toContain('Bruno');
    expect(report).toContain('/shop food');
  });

  it('says "no <diet> food" rather than a quantity when the pantry is empty for that diet', () => {
    clearFood(); give('fish', 12);
    addDino({ speciesId: 'brachiosaurus' });
    ctx.setNow(48 * H);
    const { skipped } = feedAll(ctx, 'u1');
    const report = feedSkipReport(ctx, 'u1', skipped);
    expect(report).toContain('no herbivore food');
    expect(report).not.toContain('0 Ferns');
  });

  it('truncates a long list rather than naming every dino', () => {
    clearFood();
    for (let n = 0; n < 9; n++) addDino({ nickname: `Herb${n}` });
    ctx.setNow(48 * H);
    const { skipped } = feedAll(ctx, 'u1');
    expect(skipped).toHaveLength(9);
    const report = feedSkipReport(ctx, 'u1', skipped);
    expect(report).toContain('Herb0');
    expect(report).toContain('+3 more');
    expect(report).not.toContain('Herb8');
  });
});

describe('/feed all surface', () => {
  it('reports which dinos were skipped and what they need', async () => {
    clearFood(); give('ferns', 1_000); give('fish', 12);
    addDino({ nickname: 'Bruno' });                                  // herbivore, feeds fine
    addDino({ speciesId: 'tyrannosaurus', nickname: 'Rexy' });       // carnivore 80, skips
    ctx.setNow(48 * H);
    const i = fakeCommand({ name: 'feed', sub: 'all', user: 'u1' });
    await feedCmd().execute(ctx, i.asChatInput() as ChatInputCommandInteraction);
    const text = embedText(i.replies[0]);
    expect(text).toContain('Rexy');
    expect(text).toContain('12 Fish');
    expect(text).not.toContain('Bruno');            // fed dinos are not in the skip list
  });
});

describe('alert Feed all button surface', () => {
  it('reports which dinos were skipped and what they need', async () => {
    clearFood(); give('ferns', 1_000); give('fish', 12);
    addDino({ nickname: 'Bruno' });
    addDino({ speciesId: 'tyrannosaurus', nickname: 'Rexy' });
    ctx.setNow(48 * H);
    const b = fakeButton({ customId: 'alert:feedall:u1', user: 'u1' });
    await alertComp().execute(ctx, b.asInteraction() as unknown as ButtonInteraction);
    const text = embedText(b.replies[0]);
    expect(text).toContain('Rexy');
    expect(text).toContain('12 Fish');
    const p = b.replies[0] as { attachments?: unknown[] };
    expect(p.attachments).toEqual([]);              // still sheds the alert banner
  });
});

describe('/feed one shortfall message', () => {
  it('names the shortfall when the pantry holds that diet but not enough of it', () => {
    clearFood(); give('fish', 12);
    const rex = addDino({ speciesId: 'tyrannosaurus' });
    ctx.setNow(48 * H);
    expect(() => feedDino(ctx, 'u1', rex.id)).toThrow(CareError);
    expect(() => feedDino(ctx, 'u1', rex.id)).toThrow(/12.*Fish|Fish.*12/);
    expect(() => feedDino(ctx, 'u1', rex.id)).not.toThrow('You have no carnivore food');
  });

  it('keeps the empty-pantry wording untouched', () => {
    clearFood();
    const d = addDino();
    ctx.setNow(48 * H);
    expect(() => feedDino(ctx, 'u1', d.id))
      .toThrow('You have no herbivore food — buy Ferns with /shop food.');
  });
});

// The skip report is the first surface to put a dino NICKNAME into a public embed
// description and a public message content since /dino rename shipped, and both render
// `[text](url)` as a masked link with arbitrary visible text. These two tests pin WHERE
// that is defended: the renderer passes a nickname through verbatim, and the only thing
// standing between a player and a live "Free Nitro" link is renameDino's store-site
// defangLinks call. The first test is what stops the second from being vacuous — without
// it, the second would pass just as happily against a renderer that stripped the whole
// nickname, or against a game that never stored one.
describe('skip report nickname safety', () => {
  const PAYLOAD = '[Free Nitro](https://evil.tld)';

  const skipReportFor = () => {
    ctx.setNow(48 * H);
    const { skipped } = feedAll(ctx, 'u1');
    expect(skipped).toHaveLength(1);
    return feedSkipReport(ctx, 'u1', skipped);
  };

  it('does NOT sanitise on its own — a raw nickname reaches the report intact', () => {
    clearFood();
    addDino({ speciesId: 'tyrannosaurus', nickname: PAYLOAD });   // straight to the column
    expect(skipReportFor()).toContain('](');
  });

  it('carries no live masked link for a nickname stored through renameDino', () => {
    clearFood();
    const rex = addDino({ speciesId: 'tyrannosaurus' });
    renameDino(ctx, 'u1', rex.id, PAYLOAD);
    const report = skipReportFor();
    expect(report).not.toContain('](');
    expect(report).toContain('[Free Nitro] (https://evil.tld)');   // every character survives
  });

  it('keeps the defanged form all the way onto the public /feed all embed', async () => {
    clearFood(); give('ferns', 1_000);
    const rex = addDino({ speciesId: 'tyrannosaurus' });
    addDino({ nickname: 'Bruno' });                                // something actually feeds
    renameDino(ctx, 'u1', rex.id, PAYLOAD);
    ctx.setNow(48 * H);
    const i = fakeCommand({ name: 'feed', sub: 'all', user: 'u1' });
    await feedCmd().execute(ctx, i.asChatInput() as ChatInputCommandInteraction);
    const text = embedText(i.replies[0]);
    expect(text).toContain('Free Nitro');
    expect(text).not.toContain('](');
  });
});
