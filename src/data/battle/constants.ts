export const ENERGY_CAP = 10;
export const ENERGY_REGEN_MS = 10 * 60_000;
export const MAX_ROUNDS = 30;
export const LEVEL_CAP = 10;
export const STAR_REWARD_MULT = [0, 1, 1.25, 1.5] as const; // indexed by stars 0-3 (cash/food scaling)
export const STAR_XP_MULT = [0.25, 1, 1.25, 1.5] as const;  // indexed by stars 0-3 (0 = loss consolation)
export const FIGHT_FRAME_DELAY_MS = 2500; // pause between /battle fight cinematic frame edits
