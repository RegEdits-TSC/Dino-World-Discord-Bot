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

export function eggLabel(egg: EggRow, now: number): string {
  const base = `🥚 #${egg.id} ${capitalize(egg.rarity)}`;
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
