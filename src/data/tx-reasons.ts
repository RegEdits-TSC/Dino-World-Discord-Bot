// What a ledger row leaves behind that reversing it does NOT undo. A reversal moves money and
// nothing else, so the ledger view says so at every row rather than letting the operator
// infer it.
//
// This table must name EVERY reason src/ actually emits, payouts included — not only the
// charges. The suppression rule in sideEffectNoteFor (src/modules/admin/service.ts) blanks the
// unrecognised FALLBACK on a row that took no money, so a payout missing from here renders as
// nothing at all, and a blank is indistinguishable from "this row left nothing behind". That
// silence was live across most of the payout reasons at once — `trade` (the counterparty's own
// row is still unreversed), `admin:give` (one command can grant an egg, a dino and food
// alongside the cash), `milestone`, `expedition-loot`, `quest`/`season`, and `battle` — several
// of them the rows an operator is most likely to reach for. tests/tx-reasons.test.ts scrapes the reason literals
// straight out of the economy call sites in src/ and fails until each one is answered here, so
// the sign-based suppression only ever fires for a reason nobody has taught this table yet.
//
// Null-prototype, the same shape as PADDOCKS and FACILITIES: a plain object would read back
// a truthy value for `constructor` or `__proto__` and claim a side effect that is not there.
const SIDE_EFFECTS = Object.assign(Object.create(null) as Record<string, string>, {
  build: 'the lot still stands',
  upgrade: 'the lot keeps its level',
  landmark: 'the landmark tier stays raised',
  attraction: 'the attraction row remains',
  decorate: 'the decor stays on the lot',
  'shop-egg': 'the egg remains',
  mythic: 'the egg remains',
  breed: 'the breeding row remains',
  splice: 'traits were re-rolled — irreversible',
  sell: 'the dino was destroyed; the cash returning does not bring it back',
  rescue: 'the dino is already un-escaped',
  expedition: 'the expedition row remains',
  'shop-food': 'the food is a separate ledger row needing its own reversal',
  feed: 'the dino was already fed',
  // Payout reasons below. Each one is money paid OUT, so reversing it CLAWS BACK — and every
  // one of them leaves a claim, a clear or an item standing that the clawback does not touch.
  // NOT "nothing to undo", which is what this entry first said and is false: collectIncome
  // (src/modules/park/service.ts) stamps the collection anchor in the SAME transaction as the
  // cash, and a reversal touches only wallets and the ledger — so the money goes back and the
  // window stays spent. On the highest-volume payout row in the ledger, that is exactly the
  // residue this column exists to name.
  collect: 'the collection window is already spent, so the player cannot collect that stretch of income again',
  'expedition-loot': 'the expedition stays claimed, its egg remains, and its food is a separate ledger row',
  battle: 'the stage clear, its stars, the dinos’ experience and any boss egg stay',
  quest: 'the quest board, streak chest or achievement stays claimed',
  season: 'the season rungs stay claimed',
  milestone: 'the attendance milestone stays claimed',
  trade: 'the items already changed hands, and the other player’s side is its own ledger row',
  // `admin:give` — one command can grant cash AND an egg AND a dino under this single reason,
  // so reversing the cash row silently leaves the other two behind. The reset marker shares
  // this prefix (`admin:reset`) and never reaches this lookup: both surfaces branch on it
  // first — the ledger renders it as its own line, and adminReverse refuses it outright.
  admin: 'any egg or dino granted by the same command remains, and granted food is a separate ledger row',
} satisfies Record<string, string>);

// The fallback, exported because the payout suppression in src/modules/admin/service.ts has
// to name it rather than re-typing the string a second time.
export const UNRECOGNISED_SIDE_EFFECT = 'unrecognised — check manually';

// What the table actually knows about this reason, or null when it has never heard of it.
// The two are a REAL distinction and not a formatting detail: a caller that wants to drop the
// fallback while keeping the genuine entries — sideEffectNoteFor (src/modules/admin/service.ts)
// is the only one — must branch on this. String-comparing sideEffectFor's output against the
// fallback would work today and break silently the moment that wording is edited.
export function knownSideEffectFor(reason: string): string | null {
  if (reason === 'reverse') return '—';
  const prefix = reason.split(':')[0] ?? '';
  return Object.hasOwn(SIDE_EFFECTS, prefix) ? SIDE_EFFECTS[prefix]! : null;
}

export function sideEffectFor(reason: string): string {
  return knownSideEffectFor(reason) ?? UNRECOGNISED_SIDE_EFFECT;
}
