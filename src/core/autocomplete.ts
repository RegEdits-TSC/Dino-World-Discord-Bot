import type { AutocompleteInteraction, ApplicationCommandOptionChoiceData } from 'discord.js';
import { schema } from './db/index.js';
import type { Species } from '../data/types.js';

// One suggestion row. `valid` drives ranking only: invalid rows are still selectable and
// fail in the execute path with the existing ephemeral errors (spec: all state-tagged, valid first).
export interface AcEntry {
  value: string | number;
  label: string;
  valid: boolean;
}

const MAX_CHOICES = 25;
const MAX_NAME = 100;

export function matches(query: string, ...haystacks: Array<string | number | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return haystacks.some((h) => h != null && String(h).toLowerCase().includes(q));
}

export function emptyRow(label: string, value: string | number): AcEntry {
  return { value, label, valid: false };
}

export async function respondRanked(i: AutocompleteInteraction, entries: AcEntry[]): Promise<void> {
  const ranked = [...entries.filter((e) => e.valid), ...entries.filter((e) => !e.valid)]
    .slice(0, MAX_CHOICES)
    .map((e) => ({ name: e.label.slice(0, MAX_NAME), value: e.value }));
  await i.respond(ranked as ApplicationCommandOptionChoiceData[]);
}

export function fmtDuration(ms: number): string {
  const totalMin = Math.max(1, Math.floor(ms / 60_000));
  const d = Math.floor(totalMin / 1440), h = Math.floor((totalMin % 1440) / 60), m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type EggRow = typeof schema.eggs.$inferSelect;
type DinoRow = typeof schema.dinos.$inferSelect;

// `locked` is an argument, not a row field: escrow is derived per user
// (locksFor, src/core/locks.ts) and this formatter has no ctx. Callers build the
// lock map ONCE and pass membership — never one query per row.
export function eggLabel(egg: EggRow, now: number, locked = false): string {
  const base = `🥚 #${egg.id} ${capitalize(egg.rarity)}`;
  // Checked first: a locked egg cannot be incubated or hatched, so the lock is the
  // state the player needs, whatever the timer says.
  if (locked) return `${base} — locked in a trade`;
  if (egg.hatchesAt === null) return `${base} — in inventory`;
  if (egg.hatchesAt <= now) return `${base} — READY`;
  return `${base} — hatching, ${fmtDuration(egg.hatchesAt - now)} left`;
}

// 75% of the 48h HUNGER_DRAIN_MS window (src/core/clock.ts) — spec's VERY HUNGRY threshold.
export const VERY_HUNGRY_MS = 36 * 3_600_000;

export function dinoLabel(dino: DinoRow, species: Species, now: number): string {
  const base = `🦖 #${dino.id} ${species.name}`;
  if (dino.escapedAt !== null) return `${base} — ESCAPED, rescue first`;
  const loc = dino.lotId != null ? `(lot ${dino.lotId})` : '(unassigned)';
  const sinceFed = now - dino.lastFedAt;
  if (sinceFed >= VERY_HUNGRY_MS) return `${base} — VERY HUNGRY ${loc}`;
  const hours = Math.floor(sinceFed / 3_600_000);
  return hours < 1 ? `${base} — fed just now ${loc}` : `${base} — fed ${hours}h ago ${loc}`;
}

export interface ListCandidate { id: number; label: string }

// Completes the last token of a comma/whitespace-separated id list (same grammar as
// parseIdList in src/modules/trading/validate.ts). Selecting a choice replaces the whole
// field, so every value re-emits the prior ids as a prefix.
export function listCompleter(
  rawInput: string,
  candidates: ListCandidate[],
  opts: { maxItems: number },
): Array<{ name: string; value: string }> {
  const endsOpen = rawInput.trim() !== '' && !/[\s,]$/.test(rawInput);
  const tokens = rawInput.split(/[\s,]+/).filter(Boolean);
  const active = endsOpen ? tokens[tokens.length - 1] : '';
  const prior = [...new Set(endsOpen ? tokens.slice(0, -1) : tokens)];
  const prefix = prior.join(', ');
  if (prior.length >= opts.maxItems) {
    return [{ name: `Max ${opts.maxItems} items per side`, value: prefix }];
  }
  const taken = new Set(prior.map(Number));
  const rows: Array<{ name: string; value: string }> = [];
  for (const c of candidates) {
    if (taken.has(c.id) || !matches(active, c.id, c.label)) continue;
    const value = prefix ? `${prefix}, ${c.id}` : String(c.id);
    if (value.length > MAX_NAME) return [{ name: 'List too long — type manually', value: prefix }];
    const name = `${value} — ${c.label}`;
    rows.push({ name: name.length <= MAX_NAME ? name : `…${name.slice(-(MAX_NAME - 1))}`, value });
    if (rows.length === MAX_CHOICES) break;
  }
  return rows;
}
