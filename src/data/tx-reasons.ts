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

export function sideEffectFor(reason: string): string {
  if (reason === 'reverse') return '—';
  const prefix = reason.split(':')[0] ?? '';
  return Object.hasOwn(SIDE_EFFECTS, prefix)
    ? SIDE_EFFECTS[prefix]!
    : 'unrecognised — check manually';
}
