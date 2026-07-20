import { and, isNull, lte, eq } from 'drizzle-orm';
import { schema, type Db } from './db/index.js';

export type Timer = typeof schema.timers.$inferSelect;
type Handler = (t: Timer) => Promise<void>;

export class Scheduler {
  private handlers = new Map<string, Handler>();
  // ids of timers attempted this process but NOT completed (failed handler / unregistered kind);
  // prevents tight in-process retry. Successes are removed since the handledAt query filter already excludes them.
  private attempted = new Set<number>();
  constructor(private db: Db) {}

  register(kind: string, handler: Handler): void { this.handlers.set(kind, handler); }

  enqueue(t: { kind: string; userId: string; refId: number; originGuildId: string | null; firesAt: number }): void {
    this.db.insert(schema.timers).values(t).run();
  }

  async tick(now: number): Promise<number> {
    const due = this.db.select().from(schema.timers)
      .where(and(isNull(schema.timers.handledAt), lte(schema.timers.firesAt, now)))
      .orderBy(schema.timers.firesAt).all()
      .filter((t) => !this.attempted.has(t.id));
    let fired = 0;
    for (const t of due) {
      this.attempted.add(t.id);
      const handler = this.handlers.get(t.kind);
      if (!handler) continue;
      try {
        await handler(t);
        this.db.update(schema.timers).set({ handledAt: now })
          .where(eq(schema.timers.id, t.id)).run();
        this.attempted.delete(t.id);
        fired++;
      } catch (err) {
        console.error(`timer ${t.id} (${t.kind}) failed`, err);
      }
    }
    return fired;
  }
}
