import type { Archetype } from '../types.js';
import { MAX_ROUNDS } from './constants.js';

export interface Combatant {
  key: string; name: string; speciesId: string; archetype: Archetype;
  maxHp: number; hp: number; atk: number; def: number; spd: number; side: 0 | 1;
}
export interface BeatSummary { title: string; lines: string[] }
export interface BattleResult {
  won: boolean; rounds: number; squadKos: number; squadSurvivors: string[];
  beats: [BeatSummary, BeatSummary]; finalHp: Record<string, number>;
}

interface FightEvent { round: number; line: string; dmg: number; ko: boolean }

const MAX_BEAT_LINES = 5;   // embed field limit headroom

export function resolveBattle(squad: Combatant[], npcs: Combatant[], rng: () => number): BattleResult {
  // Copy combatants (pure function), then fix initiative:
  // spd desc; ties by side asc then index asc — squad precedes npcs in the
  // combined array, so combined-index order encodes exactly that.
  const order = [...squad, ...npcs]
    .map((c, i) => ({ c: { ...c }, i }))
    .sort((a, b) => b.c.spd - a.c.spd || a.c.side - b.c.side || a.i - b.i)
    .map((e) => e.c);

  const events: FightEvent[] = [];
  let rounds = 0;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    rounds = round;
    for (const actor of order) {
      if (actor.hp <= 0) continue;
      const enemies = order.filter((c) => c.side !== actor.side && c.hp > 0);
      if (enemies.length === 0) break;
      let target = enemies[0];
      for (const e of enemies) if (e.hp < target.hp) target = e;   // focus lowest-hp
      const variance = 0.85 + 0.30 * rng();
      const crit = rng() < 0.10;                                   // crit rolled AFTER variance
      let dmg = Math.max(1, Math.round(actor.atk * variance - target.def * 0.5));
      if (crit) dmg = Math.round(dmg * 1.5);
      target.hp = Math.max(0, target.hp - dmg);
      const ko = target.hp === 0;
      events.push({
        round, dmg, ko,
        line: `${actor.name} hits ${target.name} for ${dmg}` +
          `${crit ? ' (CRIT!)' : ''}${ko ? ` — ${target.name} is down!` : ''}`,
      });
      if (actor.archetype === 'support') {
        const allies = order.filter((c) => c.side === actor.side && c.hp > 0);
        let low = allies[0];
        for (const a of allies) if (a.hp < low.hp) low = a;
        const heal = Math.round(0.25 * dmg);
        if (heal > 0 && low.hp < low.maxHp) {
          low.hp = Math.min(low.maxHp, low.hp + heal);
          events.push({ round, dmg: 0, ko: false, line: `${actor.name} mends ${low.name} for ${heal}` });
        }
      }
    }
    const squadAlive = order.some((c) => c.side === 0 && c.hp > 0);
    const npcsAlive = order.some((c) => c.side === 1 && c.hp > 0);
    if (!squadAlive || !npcsAlive) break;
  }

  const squadFinal = order.filter((c) => c.side === 0);
  const won = order.filter((c) => c.side === 1).every((c) => c.hp <= 0)
    && squadFinal.some((c) => c.hp > 0);
  const finalHp: Record<string, number> = {};
  for (const c of order) finalHp[c.key] = c.hp;
  return {
    won,
    rounds,
    squadKos: squadFinal.filter((c) => c.hp <= 0).length,
    squadSurvivors: squadFinal.filter((c) => c.hp > 0).map((c) => c.key),
    beats: buildBeats(events, rounds),
    finalHp,
  };
}

function buildBeats(events: FightEvent[], totalRounds: number): [BeatSummary, BeatSummary] {
  if (events.length === 0) {
    // Degenerate input (empty side, or a side that entered fully KO'd) means
    // the fight loop never produced an attack. Task 10 renders `lines`
    // directly as Discord embed field values, which reject an empty string,
    // so the "always exactly two beats, each with >=1 non-empty line"
    // contract must hold even here.
    return [
      { title: 'Opening clash', lines: ['No blows were exchanged.'] },
      { title: 'The climax', lines: ['No blows were exchanged.'] },
    ];
  }
  const mid = Math.ceil(totalRounds / 2);
  const first = events.filter((e) => e.round <= mid);
  let second = events.filter((e) => e.round > mid);
  if (second.length === 0) {
    // battle ended inside the first half — climax is the last round's action
    second = events.filter((e) => e.round === events[events.length - 1].round);
  }
  const top = [...first].sort((a, b) => b.dmg - a.dmg).slice(0, MAX_BEAT_LINES);
  const f2 = first.filter((e) => top.includes(e)).map((e) => e.line);   // chronological order
  let finalBlow = second[second.length - 1];
  for (const e of second) if (e.dmg > 0) finalBlow = e;                 // last attack, never a heal
  const climax = second.filter((e) => e.ko || e === finalBlow);
  const f3 = climax.slice(-MAX_BEAT_LINES).map((e) => e.line);
  return [
    { title: 'Opening clash', lines: f2 },
    { title: 'The climax', lines: f3 },
  ];
}

export function starsFor(r: BattleResult): 0 | 1 | 2 | 3 {
  if (!r.won) return 0;
  if (r.squadKos === 0) return 3;
  if (r.squadKos <= 1 || r.rounds <= 12) return 2;
  return 1;
}
