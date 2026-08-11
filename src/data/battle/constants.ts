export const ENERGY_CAP = 10;
export const ENERGY_REGEN_MS = 10 * 60_000;
export const MAX_ROUNDS = 30;
export const LEVEL_CAP = 10;
export const STAR_REWARD_MULT = [0, 1, 1.25, 1.5] as const; // indexed by stars 0-3 (cash/food scaling)
export const STAR_XP_MULT = [0.25, 1, 1.25, 1.5] as const;  // indexed by stars 0-3 (0 = loss consolation)
export const FIGHT_FRAME_DELAY_MS = 2500; // pause between /battle fight cinematic frame edits

// --- Duels (spec 3b). Duels are free: no energy constant belongs here. ---
export const DUEL_K = 32;
export const DUEL_START_RATING = 1000;
// Directional, ghost-path only: you cannot re-ghost the same defender inside this
// window; they can counter-attack you instantly. Derived from the duels log at read
// time — nothing sweeps.
export const DUEL_PAIR_COOLDOWN_MS = 6 * 3_600_000;
// How long a posted /duel challenge stays clickable. The expiry instant is baked
// into the button's customId, so no pending-challenge row is ever stored.
export const DUEL_CHALLENGE_TTL_MS = 15 * 60_000;
