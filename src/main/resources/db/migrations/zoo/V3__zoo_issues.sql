-- Dino-World: zoo module, migration V3.
--
-- zoo_issue: a per-player log of warnings about a player's park —
-- low-happiness dinos, dinos with no enclosure (homeless), staff who quit
-- because wages went unpaid, and a tiered "wage runway" warning when the
-- player's coin balance is approaching the point where staff will quit.
--
-- Surfaced via /zoo issues. Tick services that already detect these
-- conditions write rows here; resolved rows stay for ~30 days for
-- analytics, then a startup sweep purges them.
--
-- target_id is intentionally NOT a foreign key. Staff rows are deleted
-- when staff quit, but the resulting issue must outlive the row it points
-- to (it records a past event). Dino-targeted issues use the same
-- looseness so the schema stays uniform; dead targets are cleaned up by
-- the auto-resolve sweep when the underlying dino disappears.

CREATE TABLE zoo_issue
(
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id   INTEGER NOT NULL,
    issue_type      TEXT    NOT NULL,        -- 'low_happiness' | 'homeless_dino' | 'staff_unpaid' | 'wages_underfunded'
    severity        TEXT    NOT NULL,        -- 'warning' | 'critical'
    target_kind     TEXT,                    -- 'dino' | 'staff' | NULL for per-player issues
    target_id       INTEGER,                 -- dino_instance.id or staff_member.id (snapshot; not FK)
    detail          TEXT    NOT NULL,        -- short pre-rendered phrase shown in the list
    first_seen_at   INTEGER NOT NULL,
    last_seen_at    INTEGER NOT NULL,
    resolved_at     INTEGER                  -- NULL while open
);

CREATE INDEX idx_zoo_issue_owner_open ON zoo_issue (owner_user_id, resolved_at);

-- Open-issue uniqueness: at most one open row per (owner, type, target).
-- COALESCE collapses NULL targets so per-player issues (e.g.
-- wages_underfunded) still get unique-per-type protection. The partial
-- predicate on resolved_at IS NULL means closed rows don't conflict —
-- exactly the "raise-if-not-already-open" semantics ZooIssueService.raise
-- relies on for its UPSERT.
CREATE UNIQUE INDEX idx_zoo_issue_open_unique
    ON zoo_issue (owner_user_id, issue_type, COALESCE(target_kind, ''), COALESCE(target_id, -1))
    WHERE resolved_at IS NULL;
