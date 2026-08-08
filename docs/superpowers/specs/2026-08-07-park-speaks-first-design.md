# The Park Speaks First — design

Spec 1b of a three-part roadmap. Two proactive alerts delivered by a recurring
sweep, action buttons on every passive notification, a per-user mute, and the
repair of a shipped defect that has kept channel notifications silent since
launch.

## 1. Why

Spec 1a made the world move on its own clock. The bot still only ever speaks to
confirm something the player started: an egg finished, a breeding finished, an
expedition came home. Every one of those is a receipt.

Meanwhile the simulation continuously computes two things that cost the player
real value and tells them about neither:

- **Escapes.** `escapeAt()` (`src/core/clock.ts:70-74`) knows the exact instant a
  dino will bolt. `/park view` already renders a warning badge from it
  (`src/modules/park/index.ts:51`, `:117-121`) — but only for a player who
  happens to look. A player who does not open Discord loses the dino, its
  income, its contribution to rating, and pays a recapture fee.
- **The income cap.** `accruedIncome` hard-stops at `capHours`
  (`src/core/clock.ts:86`). Past that instant a park earns nothing at all, and
  nothing anywhere announces it.

Both are pure, already-tested functions whose output is discarded. This spec
makes the park reach out on its own, and makes every notification actionable
from where it lands rather than sending the player off to type a command with an
id they have to look up.

### Roadmap context

| Part | Theme | Status |
| --- | --- | --- |
| 1a | The Living World — global events, seasons, `/world` | shipped 2026-08-07 |
| 1b | The Park Speaks First — proactive alerts, buttons on notifications | **this spec** |
| 2 | Depth & Endgame — habitat enrichment, prime decor sink, hatchery L4–L5, veteran ranks, `/dex` | later |
| 3 | The Server Is A Park — exhibition duels, rich park visits, wider leaderboards | last |

Expedition dispatches, named in the roadmap's 1b line, are **cut** — see §14.

## 2. Design decisions

Settled during brainstorming and during a six-lens adversarial verification of
the design against the source. Not open questions.

| Decision | Choice | Why |
| --- | --- | --- |
| Alert roster | **Escape + income cap only** | Both are active loss the player cannot currently see coming. Idle-capacity and streak-at-risk alerts are nagging about opportunity, not loss. |
| Substrate | **One recurring sweep** | Recomputes the predicates fresh each pass. The alternative — enqueue a timer at feed time — is stored derived state that eight separate mutation sites would have to cancel and re-enqueue, exactly the bug class the escrow-lock rewrite deleted 11 call sites to kill. |
| Trigger | **Level, with an idempotency record** | Edge-triggering on a window cannot survive a double-fired tick, a late fire, downtime, or an instant that moves backwards. All four occur here. See §4. |
| Escape cadence | **Two tiers: T−12h and T−1h** | One warning risks being read too late; repeating every sweep is up to 48 pings per dino. Two is the whole budget. |
| Bundling | **One combined message** | Both conditions in a single embed with one button row. Matches the daily quest hint, which fires one combined followUp rather than one per quest. |
| Alert delivery | **DM only** | A sweep timer has no originating guild. Channel routing would mean guessing one from `user_guilds`, which is only maintained for guild commands and buttons, is never cleared by `adminReset`, and on a stale row posts successfully into a channel the player cannot see, with no fallback. |
| Opt-out | **Per-user flag, default on** | One `users` column, set by `/park alerts` or by a Mute button on the alert itself. Completion notifications stay ungated — those were asked for. |
| Buttons | **All five notifications** | The three completion pings are where the "now go type the command with the right id" friction is worst, and each already names a `refId` a button can carry. |
| Ping repair | **In this spec** | 1b is the spec whose subject is the bot's voice. Shipping proactive alerts while completion pings remain mute would be incoherent. |

## 3. Architecture

Five pieces, each independently testable:

1. **`alert_sweep` timer** — one self-re-arming row, sentinel-keyed, 15-minute
   period. Lives in `src/modules/park/alerts.ts`.
2. **`alerts_sent` table** — the idempotency record. Not derived state; a log of
   side effects performed.
3. **Two predicates** — pure functions over `toClockDinos`' output.
4. **One combined payload builder** — plus the six button handlers.
5. **`withMention` repair** — per-message `allowedMentions`.

Nothing new is stored that could go stale. The sweep derives *when* to alert on
every pass; `alerts_sent` only records *that* it did.

## 4. The sweep

### The timer

New kind `alert_sweep`, `SWEEP_MS = 15 * 60_000`, enqueued with
`userId: '0'`, `refId: 0`, `originGuildId: null` — the shape
`src/modules/world/broadcast.ts:32-33` established.

The sentinel is load-bearing, not incidental. `adminReset` deletes timers by
exact userId (`src/modules/admin/service.ts:51`) and `adminFastForward` shifts
them by exact userId (`:112-113`). A sentinel that could collide with a real
snowflake would let one player's reset delete the sweep for every server.
Discord ids start far above `'0'`.

Four guards. The first three are copied from `broadcast.ts`; the fourth it lacks.

1. **Boot arm checks first.** `timers` has no unique index
   (`src/core/db/schema.ts:140-148`), so `armAlertSweep` returns early if a
   pending row of the kind already exists — the `broadcast.ts:27-30` pattern.
2. **Re-arm excludes its own row** via `ne(timers.id, t.id)`
   (`broadcast.ts:80-83`). Without it, two processes racing the same due row
   both re-arm and growth is 2ⁿ; with it, the pair converges back to one on the
   next fire.
3. **Per-user `try/catch` inside the fan-out** (`broadcast.ts:51-60`). One bad
   user must not abort the rest, because `Scheduler.tick` writes `handledAt`
   only after the handler *resolves* (`src/core/scheduler.ts:31-36`) — a
   throwing fan-out would also skip the re-arm.
4. **The re-arm block gets its own `try`.** `broadcast.ts:80-88` has none. It
   matters more here: `scheduler.ts:28` adds the timer to `attempted` *before*
   the handler lookup at `:29-30`, so a throwing handler is parked for the life
   of the process behind a single `logger.error` (`:38`) — and an *unregistered*
   kind reaches the identical dead state with **no log line at all**.

Registration goes at `src/index.ts:35-38`, alongside the other four
`scheduler.register` calls and before the 30s interval at `:40`. `armAlertSweep`
goes next to `armWorldBroadcast` at `:49`, before the boot-scan tick at `:50`.

Re-arm at `now + SWEEP_MS`, reading the single `now` captured at handler start —
the `broadcast.ts:39`/`:86` discipline. Grid-versus-run-time anchoring, which
would matter for an edge-triggered window, is moot under level triggering.

### Why not edge triggering

The original design computed a window `(from, now]` and alerted when a crossing
instant landed inside it. Verification against the source killed it on four
independent counts:

- **`broadcast.ts` is grid-anchored** (`nextMidnight`, `:20-22`), so
  `firesAt − PERIOD` is the previous grid slot, never the previous run time.
  Adapting it means choosing between a grid anchor (overlaps by δ on every late
  fire — every edge in that δ alerts twice) and a run-time anchor (phase drifts
  forward ~96 times a day, and the boot seed never covers pre-boot edges).
- **The same timer can run twice.** `attempted` is consulted exactly once, in
  the due-snapshot filter (`scheduler.ts:25`), and `setInterval` does not await
  the in-flight tick (`index.ts:40`). A tick stalled behind a slow handler
  re-runs a row the next tick already handled.
- **The escape instant is not monotone.** `feedDino` sets `hunger: food.fillTo`
  unconditionally (`src/modules/care/service.ts:63`) and hunger legitimately
  sits at 150, so tier-1 food on an overfed dino moves `escapeAt` *earlier*.
  Reassignment, splicing Grazer or Skittish, and `rescueDino` all move it too.
- **Downtime.** The surviving row's lower bound is a pre-outage instant, so the
  boot scan sweeps the entire outage in one pass.

### Level triggering

```
alerts_sent
  userId      text     -- FK users.discord_id
  kind        text     -- 'escape' | 'income_cap'
  refId       integer  -- dinoId for escape, 0 for income_cap
  tier        text     -- 'heads_up' | 'last_call' for escape, '' for income_cap
  firedForMs  integer  -- the escapeAt / capAt value this alert fired for
  sentAt      integer
  PRIMARY KEY (userId, kind, refId, tier)
```

Composite PK in the `user_stats` style (`schema.ts:164-171`).

**Send iff** the condition holds *now* **and** no row exists whose `firedForMs`
equals the current instant. On send, upsert via `onConflictDoUpdate`.

Because `escapeAt` is stable between sweeps unless the player acts, this never
re-alerts on its own. If a feed moves the instant and the dino is *still* inside
the window, the key no longer matches and exactly one fresh warning goes out —
which is correct. The scheme is immune to the double-fired tick, to late fires,
to downtime, and to instants that move in either direction.

Rows older than `ALERT_RECORD_TTL_MS` (30 days) are pruned, one DELETE per
sweep. A pruned row can only re-fire for an instant 30 days stale, which the
`escapeAt > now` and `pending > 0` conjuncts already exclude.

### Per-user work

`toClockDinos` (`src/modules/park/service.ts:121-141`) is exactly three queries
and returns `{ clockDinos, lots, user, dinos }` — every input both predicates
need, with `clockDinos` and `dinos` index-aligned as two existing call sites
already rely on (`park/escapes.ts:10-19`, `park/dinos.ts:79-85`).

- **Do not** route through `pendingIncome` (`park/service.ts:143-146`): it calls
  `toClockDinos` again, doubling the cost. Call `accruedIncome` directly.
- **Do not** reuse `buildParkSnapshot`: it calls `settleEscapes`
  (`park/snapshot.ts:28`).
- **The sweep must not call `settleEscapes`.** A background job materializing
  escapes would change *when* they happen. It does not need to:
  `accruedIncome` already clamps each dino at its derived `escapeAt` whether or
  not the row is stamped (`clock.ts:96-100`).

The per-user catch also contains `getSpecies`, which **throws** on an unknown id
(`src/data/species/index.ts:59-62`) and is called once per dino
(`park/service.ts:133`). Without the catch, one bad row kills alerts for the
whole process.

Sweep set: users with `alertsEnabled` true and at least one lot.

**Scaling ceiling, documented not solved:** three queries per swept user per 15
minutes, and the sweep does not bound its per-tick user count. Within one tick
handlers are serial and ordered by `firesAt` (`scheduler.ts:22-24`), but the
interval does not await, so a long fan-out can interleave with a completion
handler. Nothing corrupts — every write is synchronous — but the exposure window
grows linearly in user count.

## 5. The two alerts

### Escape

Per clock dino: `escapedAt === null` ∧ `escapeAt(d) !== null` ∧
`escapeAt(d) > now` ∧ `escapeAt(d) − now ≤ LEAD`.

`escapeAt` returns `escapedAt` verbatim when stamped and `null` when the dino
has no paddock (`clock.ts:70-74`, `:61`), so an unassigned or already-escaped
dino cannot fire. The `> now` conjunct is what keeps a post-downtime sweep
honest: a dino that already bolted produces an instant in the past and is
silently skipped.

| tier | LEAD |
| --- | --- |
| `heads_up` | `ESCAPE_WARN_MS` = 12h (`clock.ts:11`) |
| `last_call` | `ESCAPE_LAST_CALL_MS` = 1h (new) |

Reusing `ESCAPE_WARN_MS` is deliberate: the DM then arrives at exactly the
instant `/park view` starts showing its badge (`park/index.ts:51`, `:117-121`),
so the two surfaces can never disagree.

**Tier collapse rule.** Firing a tier marks every *less urgent* tier for the
same `firedForMs` as sent. Without it, a dino that first becomes observable
already inside 1h — assign a starving dino — fires `last_call` immediately and
then `heads_up` on the next sweep, because the wider window is still satisfied
and its key is still free. This is the one non-obvious rule in the feature. It
gets a comment at the call site and a dedicated test.

### Income cap

`now ≥ capAt` ∧ `pending > 0`, where
`capAt = user.lastCollectAt + capHours(lots) × 3_600_000`.

Three facts the copy must respect:

- **`capAt` is an upper bound, not the instant earning stopped.**
  `accruedIncome` clamps each dino independently at its own `escapeAt` and at
  `hungerZero` (`clock.ts:96-99`), so real earning stops at
  `min(capAt, max over dinos of dinoEnd)`. The embed says "your park has hit its
  8-hour income cap"; it never claims a precise instant.
- **`capAt` is not "time since you pressed Collect".** `collectIncome` writes
  `lastCollectAt` only when `amount > 0` (`park/service.ts:150-156`).
- **`pending > 0` is not monotone.** `accruedIncome` recomputes the whole window
  from *current* hunger, and `comfortAt` clamps at 100 (`clock.ts:55`), so a
  starved park reading 0 jumps to a full capped payout the moment its owner
  feeds. Level triggering absorbs this: the alert fires on the sweep where the
  condition first becomes true. An edge-triggered design would have shipped it
  as a silent miss.

Visitor Center level 1 gives `capHours[0] = 8`, identical to having no facility
at all (`src/data/facilities.ts:6` vs `park/service.ts:57`). The copy must not
suggest building one as the fix — only L2 and above widen anything.

### The message

One combined embed. Art is already committed: `banners/care_neglect.webp` when
escapes are present, else `banners/collect.webp`. No new assets.

> **🚨 Your park needs you**
> **Unsettled dinos** — Rexy (Tyrannosaurus) escapes in ~52m · Trike escapes in ~11h
> **Income capped** — 1,240 cash pending, no longer growing
> `[🍖 Feed all] [💰 Collect] [🔕 Mute alerts]`

The dino list truncates to the five soonest, then "+ N more". The ceiling is 10
lots (`src/data/progression.ts:15`) × `paddockCapacity(4)` = 8
(`park/dinos.ts:18`) = **80 dinos**, comfortably past the 4096-character
description limit.

**The mute flag is read at the sweep's own call site**, never inside
`deliverNotification`. That function is the single choke point for **six**
passive sends — `notify.ts:64`, `:78`, `:93` plus `trading/index.ts:132`,
`:144`, `:150` — so gating it there would silently mute trade offers too.

## 6. Buttons

Two new prefixes. Taken today: `battle, daily, ach, breed, splice, hatch,
mythic, park, sell, trade`. A prefix may contain no colon
(`src/core/modules.ts:35`), and uniqueness is enforced across enabled modules
(`:21`, `:26-28`).

| notification | button | customId | handler |
| --- | --- | --- | --- |
| egg ready | 🥚 Hatch | `hatch:crack:<eggId>` | exists, reused verbatim |
| breeding done | 🧬 Claim | `breed:claim:<breedingId>` (better than the userId originally planned here — it targets the specific breeding rather than resolving "the caller's next one", and stays safe via `claimBreeding`'s `(id, userId)` filter) | new branch, existing prefix |
| expedition back | 🧭 Claim | `exp:claim:<userId>` | **new prefix** on the expeditions module |
| escape | 🍖 Feed all | `alert:feedall:<userId>` | **new prefix**, appended to `parkModule.components` |
| income cap | 💰 Collect | `alert:collect:<userId>` | same |
| both alerts | 🔕 Mute alerts | `alert:mute:<userId>` | same |

`hatch:crack` needs no owner segment: `hatchEgg` filters on `(id, userId)` and
throws `HatcheryError('You do not own that egg.')`
(`src/modules/hatchery/service.ts:50-52`), which the crack branch converts to an
ephemeral reply (`hatchery/index.ts:104-106`). Its `revealPayload` already ships
`attachments: []` with a comment naming this exact case
(`hatchery/embeds.ts:41-48`), so the pre-hatch egg thumbnail is dropped rather
than stranded. One accepted wart: the egg row is deleted on success
(`service.ts:78`), so a stale second click reports "You do not own that egg."

`breed:claim` slots into the existing prefix because `genelab/index.ts:208-209`
destructures a fixed arity and gates on `action !== 'confirm'`.

Appending to `parkModule.components` is **mandatory, not stylistic** —
`tests/dinos.test.ts:140,149,196,201,207` index `components[0]`.

**`park:collect` is not reusable.** `park/index.ts:289` is exact-string
equality, so `park:collect:<uid>` falls through every branch and returns
unacknowledged — Discord renders "This interaction failed". It also never calls
`getOrCreateUser`, and `pendingIncome` → `toClockDinos` does `.get()!`
(`park/service.ts:122-123`) before reading `user.lastCollectAt` (`:145`), so a
clicker with no row throws. Hence a separate `alert:collect`.

**Ownership.** Every button here acts on the *alerted* user, so each embeds the
owner id and rejects a mismatch — the `park:assignyes` / `park:dinos` pattern
(`park/index.ts:298`, `:311`), not the self-serve `park:collect` one. Each new
prefix also gets an unknown-action fallback that calls `deferUpdate` *before*
the owner check, copying `daily` (`daily/index.ts:36-37`); seven of the ten live
prefixes have no fallback at all today.

**Stale and failed clicks.** An alert is a persistent message, so every button
must tolerate being pressed long after the condition cleared. Each service error
becomes an ephemeral reply, never a thrown interaction: `[Feed all]` on a player
with no matching food raises `CareError` (`care/service.ts:52-53`), `[Collect]`
on an already-collected park yields 0 and reports so, and `[Claim]` on a claimed
expedition or breeding is rejected by the same server-side guards the slash
commands use. No button re-checks the alert's own predicate — the service is the
authority.

**Presentation.** `i.update` in place — valid on both channel- and DM-delivered
bot messages (`discord.js` `InteractionResponses.js:321-335`). Two attachment
rules, and they point in opposite directions:

- **On an `i.update`** replacing a file-bearing notification (`notify.ts:63`,
  `:77`, `:92`): include `attachments: []`. A payload carrying `files` replaces
  the message's whole attachment set; one carrying neither key leaves the old
  uploads in place.
- **On a payload reaching `deliverNotification`**: include **no** `attachments`
  key. That function forwards one object to two send sites (`notify.ts:33` then
  `:37`), and `MessagePayload.resolveBody` *pushes into* an explicit array
  (`MessagePayload.js:222-223`) which `create()` only shallow-copies (`:338`).
  Today's notification payloads are safe precisely because they omit it.

**Type widening.** `NotifyPayload` (`notify.ts:12`) gains optional `components`
and `allowedMentions`. Touches `notify.ts:12`, the three local payload types at
`:62`, `:76`, `:91`, and `Payload` in `src/modules/world/embeds.ts:11`. It
breaks no `Sender` fake — and there are **four**, not the three the repo
CLAUDE.md lists; it omits `tests/world-broadcast.test.ts:8-16`. That doc error
is corrected here.

`Ctx.notify` stays `message: string` (`src/core/context.ts:14`). Widening it
would drag in `tests/harness.ts:15,18,27` and `tests/trading.test.ts:290,297,304`,
and the three trade notifications are not getting buttons in this spec.

**Quest-hint exemption.** `EXEMPT_PREFIXES` is the literal `{'daily','ach'}`
(`src/modules/daily/hooks.ts:8`). A successful `i.update` sets `replied = true`,
so the guard at `hooks.ts:29` passes and `:35` fires a followUp — in a DM that is
a plain visible message, and after clicking Mute it is absurd. `alert` joins the
set.

## 7. The ping repair

`src/index.ts:32` sets `allowedMentions: { parse: [] }` client-wide,
deliberately, so that `/dino rename` and `/park rename` cannot echo a
user-supplied role mention into a public message. The consequence nobody
recorded: `withMention`'s `<@id>` (`notify.ts:22-26`) renders as an inert grey
chip. **Every channel-routed notification has notified nobody since it
shipped.** Two in-repo comments assert the opposite and are false —
`notify.ts:20-21` and `src/modules/trading/index.ts:126`, the latter sitting on
a live `i.reply` at `:130`.

Fix: `withMention` sets `allowedMentions: { users: [userId] }`. A per-message
value replaces the client default
(`discord.js` `MessagePayload.js:177-180`), and whitelisting exactly one id
preserves the rename echo-safety in full — roles, `@everyone`, and every other
user stay unpingable. Applied on the channel path only; DMs continue to go out
unmentioned. Same fix at the trade-offer reply (`trading/index.ts:130`). Both
false comments corrected.

This is independent of the rest of the spec and could be reverted alone.

## 8. Data model and migration

**Migration 0009.** `drizzle/` holds `0000`–`0008`; `_journal.json`'s last entry
is `idx: 8`.

```sql
ALTER TABLE `users` ADD `alerts_enabled` integer DEFAULT true NOT NULL;
CREATE TABLE `alerts_sent` (
  `user_id`      text    NOT NULL REFERENCES `users`(`discord_id`),
  `kind`         text    NOT NULL,
  `ref_id`       integer NOT NULL,
  `tier`         text    NOT NULL,
  `fired_for_ms` integer NOT NULL,
  `sent_at_ms`   integer NOT NULL,
  PRIMARY KEY (`user_id`, `kind`, `ref_id`, `tier`)
);
```

The `ALTER` is byte-for-byte the shape of `0008_world_broadcast.sql`, so it is
an ALTER rather than a table recreate and `migrateDb`'s `foreign_keys` bracket
(`src/core/db/index.ts:18-31`) cannot bite. `CREATE TABLE` has no recreate
hazard either.

Drizzle: `alertsEnabled: integer('alerts_enabled', { mode: 'boolean' }).notNull().default(true)`.

**What the flag gates: only the two proactive alerts.** The three completion
notifications stay unconditional — those were asked for by starting the hatch,
the breeding, the expedition. Muting must not kill the pings people rely on.

**Control surface.** `/park alerts state:on|off` — a subcommand on `/park`, the
existing user-scoped command, with a `choices` string option mirroring
`/settings world-news` (`src/modules/settings/index.ts:13-14`). `/settings` is
disqualified as a home: both its branches write to `guild_settings` (`:23-24`,
`:37-38`), and this is a per-user preference.

### ⚠️ The `/park` dispatch trap

`/park` has exactly one explicit subcommand branch — `=== 'rename'`
(`park/index.ts:83`) — followed by an unguarded else that **is** the view path
(`:90-133`). A deployed-but-unimplemented `alerts` subcommand would render the
park dashboard and report success. The branch and its test land before the
builder change.

### Registration cost

One subcommand and one deploy. A subcommand triggers **zero** of the five
module-registration sites:

- `tests/contract.test.ts:48-49` and `tests/registry-load.test.ts:9-10` count
  top-level builders (25) and modules (14) — both unchanged.
- `tests/config.test.ts:22` inventories `modules.json` keys — unchanged.
- A `choices` option cannot trip the autocomplete manifest:
  `contract.test.ts:41` records `o.autocomplete === true`, the forward loop
  iterates manifest keys (`:58-62`), and the reverse loop is `if (isFlagged)`-
  guarded (`:65-67`). `/build kind` (`park/index.ts:137-138`) and
  `/decorate item` (`:262`) are the live precedent.

`npm run deploy-commands` is still mandatory — the `/park` builder changed.

## 9. Admin

- **`adminReset` deletes `alerts_sent` rows.** The `breedings` and `user_stats`
  lesson: reset must cover every table the feature reads.
- **`adminReset` deliberately does not reset `alertsEnabled`.** A knowing
  deviation from that same rule. The flag is communication consent, not
  progress, and restoring it would un-mute a player who explicitly opted out.
  Gets a comment at `admin/service.ts:66-71`, beside the `parkName` reset it
  contradicts.
- **`adminFastForward` does not shift `alerts_sent`,** and that is what makes it
  the operator's test hook: it shifts `lastCollectAt` (`:89`) and
  `dinos.lastFedAt` (`:102-103`), the derived instants move, `firedForMs` stops
  matching, and the next sweep alerts. One caveat — the sentinel sweep row is
  not shifted either (`:112-113` filters by userId), so the operator still waits
  one real sweep period.

## 10. Testing

New `tests/alerts.test.ts`:

- Both predicates at their boundaries, including the `escapeAt > now` guard and
  the unassigned/already-escaped exclusions.
- The tier-collapse rule.
- Idempotency across a re-run of the same sweep — the double-fire case
  `tests/scheduler.test.ts` does not cover.
- A fed dino re-entering the window getting exactly one fresh alert.
- A muted user receiving nothing.
- A user whose `getSpecies` throws not killing the sweep.
- Re-arm convergence with a duplicate pending row.
- Income cap firing on the sweep where `pending` first becomes positive.

Payload limits need no new plumbing: `validateMessagePayload` is already called
directly on non-interaction payloads (`tests/battles-embeds.test.ts:8,78,152,232`).
This matters because `makeCtx`'s notify fake stores a bare string and validates
nothing (`tests/harness.ts:27`).

Button tests use `fakeButton`. Handlers must use `i.update` rather than editing
the underlying message — the harness `message` stub is bare
`{ id: 'fake-message' }` (`harness.ts:216`).

Migration test: copy the "production path" block verbatim
(`tests/migration.test.ts:374-412`) — scratch folder, journal filtered to
`idx <= 8`, `foreign_keys = ON` at `:392`, parent user **and** child dino seeded
at `:396-397`, real `migrateDb` at `:402`.

Notify test: `withMention` emits `allowedMentions: { users: [id] }`.

**`test:live` needs a structural change, not two array entries.** `Case.run()`
is typed to return a `FakeInteraction` (`scripts/test-live.ts:176`) and the
driver throws `'no reply captured'` on empty replies (`:348`); `scripts/`
constructs no `Sender` and registers no timer kind. Widen `run()` to accept a
`{ replies }`-shaped capture from a `Sender` fake, and seed a triggering state —
the current seed cannot produce one, since every dino is inserted
`hunger: 100, lastFedAt: ctx.now()` and `getOrCreateUser` stamps
`lastCollectAt: ctx.now()` (`park/service.ts:29`).

## 11. Documentation

Statements this feature falsifies, all located:

- `docs/commands.md:110` — the notification-type list; plus a `/park alerts` row.
- `docs/gameplay.md:819` §14 heading, `:821` "five things", `:823-825` "no
  hunger or escape notifications of any kind", `:845` "three timer-based",
  `:851` "four per-player notifications", `:863` "checked roughly every 30
  seconds", `:876-880` "There's no per-player notification preference anywhere
  in the game".
- `docs/ops.md:396`, `:421` — smoke-test steps.
- `HELP_TOPICS.park` (`src/modules/help/index.ts:24-25`) gains the subcommand —
  **without** an `art` key, because `withParkImage` assigns `files` and would
  drop it.
- `HELP_TOPICS.care:56` ("Low comfort long enough → the dino escapes") gains the
  warning.
- `.env.example` needs nothing — the flag is a DB column.

Repo `CLAUDE.md` gains a sweep bullet (sentinel, level trigger plus idempotency,
the no-`settleEscapes` rule, the `/park` dispatch trap) and three corrections:
the `Sender` fake list is four files not three; channel mentions did not ping;
never put an `attachments` key on a payload reaching `deliverNotification`.

## 12. Ops checklist

1. `npm run deploy-commands` — 25 stays 25, but the `/park` builder changed.
   Exactly one bot instance per token.
2. Restart the bot — migration 0009 applies via `migrateDb`, and the new timer
   kind must be registered before `armAlertSweep` can arm it. Expect a
   one-time alert burst on this first restart: `alerts_enabled` defaults to
   true for every pre-existing row, so the first sweep DMs most idle players
   at once (throttled to one send per 250ms — see `alert-sweep.ts`) — watch
   the logs for 429s.
3. `npm run test:live` — cosmetic review of the combined alert payload and the
   five button rows.

No emoji work: both banners are already committed.

## 13. Invariants for future work

- **Never call `settleEscapes` from the sweep.** It would make a background job
  materialize escapes.
- **Never swap the tier-collapse direction.** Firing a tier marks less urgent
  tiers, never more urgent ones.
- **Never gate a notification inside `deliverNotification`.** Six passive sends
  route through it, three of them trades.
- **Never add an `attachments` key to a payload handed to
  `deliverNotification`.** One object, two send sites.
- **Any new `parkModule.components` entry is appended.** Tests index `[0]`.
- **`alerts_sent` is never shifted by `adminFastForward`.** That is the test
  hook, not an oversight.

## 14. Out of scope

- **Expedition dispatches** — mid-expedition flavour messages. Cut: notification
  volume without mechanical value.
- **Idle-capacity and streak-at-risk alerts** — opportunity, not loss.
- **Per-alert toggles** — two kinds do not justify the surface.
- **Buttons on the three trade notifications** — would require widening
  `Ctx.notify` and its test fakes.
- **Channel routing for the two alerts** — DM-only by design. This also sidesteps
  the fact that `notifyChannelId` cannot be unset once set
  (`settings/index.ts:12`; `:37-38` is its sole writer), so no guild-side alert
  control ships or is needed.
- **Bounding the sweep's per-tick user count** — the scaling ceiling is
  documented in §4, not solved.
