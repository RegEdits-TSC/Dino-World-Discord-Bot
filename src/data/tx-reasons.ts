// What a charge leaves behind that reversing it does NOT undo. A reversal moves money and
// nothing else, so the ledger view says so at every row rather than letting the operator
// infer it.
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
