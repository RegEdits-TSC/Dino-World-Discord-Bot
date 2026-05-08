-- Dino-World: notify module, migration V1.
--
-- Persistent queue of scheduled DMs. Rows are inserted by
-- NotificationService.schedule(...) and drained by the `notify.dispatch`
-- TickScheduler job at a 30-second cadence.
--
-- status transitions: pending → sending → (sent | failed). 'sending' is a
-- transient state — the dispatcher flips a row to 'sending' before
-- handing it to JDA's async send, then commits to 'sent' or 'failed' in
-- the callback. NotifyModule.onEnable resets any leftover 'sending' rows
-- back to 'pending' on startup, so a crash mid-dispatch retries on the
-- next bot run.
--
-- payload_json is the JDA DataObject form of a MessageEmbed
-- (MessageEmbed.toData().toString()), parseable by EmbedBuilder.fromData.
CREATE TABLE notification_queue
(
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    due_at       INTEGER NOT NULL,                 -- epoch millis
    payload_json TEXT    NOT NULL,
    status       TEXT    NOT NULL DEFAULT 'pending',
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    sent_at      INTEGER
);

CREATE INDEX idx_notify_due ON notification_queue (status, due_at);
