-- Dino-World: core module, migration V4.
--
-- Tracks the last-fired-at instant for every named recurring job that
-- registers with the TickScheduler. On startup the scheduler reads this
-- table for each job, computes how many ticks were missed during the
-- outage, and back-fills up to a 24-hour cap before resuming the regular
-- schedule.
--
-- The 24-hour cap is intentional — players running a per-tick income game
-- get up to a day's worth of offline rewards on restart, never more,
-- regardless of how long the bot was down.
CREATE TABLE tick_state
(
    job_name     TEXT PRIMARY KEY,
    last_tick_at INTEGER NOT NULL  -- epoch millis
);
