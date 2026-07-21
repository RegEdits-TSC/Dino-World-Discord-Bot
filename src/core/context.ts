import type { Db } from './db/index.js';
import type { EconomyService } from './economy.js';
import type { Config } from './config.js';
import type { Scheduler } from './scheduler.js';

export interface Ctx {
  db: Db; economy: EconomyService; config: Config; scheduler: Scheduler;
  now(): number;        // epoch ms — injected so tests control time
  rng(): number;        // [0,1) — injected so tests are deterministic
}
