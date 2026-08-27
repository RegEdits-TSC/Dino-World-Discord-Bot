import { describe, it, expect } from 'vitest';
import { alertPayload } from '../src/modules/park/alert-embeds.js';
import { validateMessagePayload } from './lib/discord-limits.js';

const esc = (over = {}) => ({ dinoId: 1, name: 'Rexy', escapeAt: 3_600_000, tier: 'last_call' as const, ...over });
const seasonNudge = { endsAt: 3 * 86_400_000, unclaimed: 2 };
// alertPayload returns null only for the "nothing to report" case (asserted below); every
// other test here supplies at least one condition, so a non-null assertion at the call site
// is safe and keeps the assertions below unchanged.
const json = (p: NonNullable<ReturnType<typeof alertPayload>>) => p.embeds[0].toJSON();
// alertPayload's return type is `NotifyPayload & {…}`, and NotifyPayload is a UNION whose
// other arm is `string` — so `.files` is not readable off the intersection the way
// `.embeds` and `.components` are. One narrow cast here beats a cast in every test below.
const fileNames = (p: NonNullable<ReturnType<typeof alertPayload>>): Array<string | null | undefined> =>
  ((p as { files?: Array<{ name?: string | null }> }).files ?? []).map((f) => f.name);

describe('alertPayload', () => {
  it('renders both conditions in one embed with one button row', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, null, 0)!;
    const d = json(p).description ?? '';
    expect(d).toContain('Rexy');
    expect(d).toContain('1,240');
    expect(p.components).toHaveLength(1);
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Feed all button when there are no escapes', () => {
    const p = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, null, 0)!;
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:collect:u1', 'alert:mute:u1']);
  });

  it('omits the Collect button when income has not capped', () => {
    const p = alertPayload('u1', [esc()], null, null, 0)!;
    const ids = (p.components![0].toJSON() as { components: Array<{ custom_id: string }> })
      .components.map((c) => c.custom_id);
    expect(ids).toEqual(['alert:feedall:u1', 'alert:mute:u1']);
  });

  it('carries NO attachments key — deliverNotification forwards one object to two sends', () => {
    // MessagePayload.resolveBody PUSHES into an explicit attachments array and create()
    // only shallow-copies it, so a shared array accumulates duplicate ids on the second
    // send. Notification payloads are safe precisely because they omit the key.
    const p = alertPayload('u1', [esc()], null, null, 0)! as Record<string, unknown>;
    expect('attachments' in p).toBe(false);
  });

  it('truncates a large roster and says how many were hidden', () => {
    // Ceiling is 10 lots x paddockCapacity(4)=8 = 80 dinos, well past the 4096-char
    // description limit.
    const many = Array.from({ length: 80 }, (_, n) =>
      esc({ dinoId: n + 1, name: `Dino${n}`, escapeAt: (n + 1) * 60_000 }));
    const p = alertPayload('u1', many, null, null, 0)!;
    const description = json(p).description ?? '';
    expect(description).toContain('+75 more');
    // Guards the truncation count itself, not just the presence of the word "more": exactly
    // MAX_LISTED (5) roster lines should actually render alongside the hidden-count marker.
    expect(description.match(/escapes in/g)).toHaveLength(5);
    validateMessagePayload(p, 'alert payload');       // throws if any Discord limit is blown
  });

  it('passes Discord limit validation in the everyday case', () => {
    const p = alertPayload('u1', [esc()], { capAt: 0, pending: 1240, capHours: 8 }, null, 0);
    expect(() => validateMessagePayload(p, 'alert payload')).not.toThrow();
  });

  it('titles a season-only alert for the season nudge, not the generic park warning', () => {
    const p = alertPayload('u1', [], null, seasonNudge, 0)!;
    expect(json(p).title).toBe('🎖️ Season ending soon');
  });

  it('keeps the generic title when an escape or income-cap condition rides alongside the season nudge', () => {
    const withEscape = alertPayload('u1', [esc()], null, seasonNudge, 0)!;
    expect(json(withEscape).title).toBe('🚨 Your park needs you');
    const withIncome = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, seasonNudge, 0)!;
    expect(json(withIncome).title).toBe('🚨 Your park needs you');
  });

  it('dresses a season-only alert with the season banner and STILL carries no attachments key', () => {
    const p = alertPayload('u1', [], null, seasonNudge, 0)!;
    expect(fileNames(p)).toEqual(['season.webp']);
    expect(json(p).image?.url).toBe('attachment://season.webp');
    // The banner may be added; the attachments key may NEVER be. deliverNotification hands
    // ONE object to channelSend and then, on failure, to dmSend. MessagePayload.resolveBody
    // pushes resolved files into an explicit attachments array and create() only
    // shallow-copies it, so a pre-set key carries the first attempt's mutation into the
    // second and the DM ships duplicate attachment ids. Omitting the key is the whole fix.
    expect('attachments' in (p as Record<string, unknown>)).toBe(false);
  });

  it('keeps the escape and income banners when either condition rides alongside the season nudge', () => {
    // The banner arms must track the title arms: escapes lead, then income, and only a
    // season-ONLY alert gets the season banner — matching the '🎖️ Season ending soon' title.
    const withEscape = alertPayload('u1', [esc()], null, seasonNudge, 0)!;
    expect(fileNames(withEscape)).toEqual(['care_neglect.webp']);
    const withIncome = alertPayload('u1', [], { capAt: 0, pending: 500, capHours: 8 }, seasonNudge, 0)!;
    // The banner is seeded on userId, and 'u1' happens to hash to index 0 for `collect`
    // — index 0 IS the base file — so this name reads exactly as it did before seeding.
    // care_neglect and season ship no -vN siblings at all, so their seed is inert.
    expect(fileNames(withIncome)).toEqual(['collect.webp']);
    for (const p of [withEscape, withIncome]) {
      expect('attachments' in (p as Record<string, unknown>)).toBe(false);
    }
  });

  it('picks the collect banner face from the alerted player, not a constant', () => {
    // Guards the seed itself: 'u1' resolving to the base file above cannot tell a seeded
    // call from an unseeded one, so a second player pins that the face actually moves.
    const income = { capAt: 0, pending: 500, capHours: 8 };
    expect(fileNames(alertPayload('u2', [], income, null, 0)!)).toEqual(['collect-v3.webp']);
  });

  it('returns null when there is nothing to report', () => {
    // An alert with no conditions is not an empty alert, it is no alert: setDescription('')
    // is rejected outright by @discordjs/builders' embed validator, so there must be no way
    // to reach that call with escapes, income, and season all empty.
    expect(alertPayload('u1', [], null, null, 0)).toBeNull();
  });
});
