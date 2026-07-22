import { describe, it, expect } from 'vitest';
import { makeCtx, fakeAutocomplete } from './harness.js';
import { adminModule } from '../src/modules/admin/index.js';
import { allSpecies } from '../src/data/species/index.js';

const cmd = () => adminModule.commands[0];

describe('/admin give dino-species autocomplete', () => {
  it('responds [] for non-owners', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'admin', sub: 'give', user: 'intruder', focused: { name: 'dino-species', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });

  it('filters the 30-species registry by query for the owner', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'admin', sub: 'give', user: 'owner', focused: { name: 'dino-species', value: 'velo' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([{ name: 'Velociraptor (rare, carnivore)', value: 'velociraptor' }]);
  });

  it('caps the unfiltered registry at 25 rows', async () => {
    const ctx = makeCtx();
    expect(allSpecies().length).toBeGreaterThan(25);   // guards the premise
    const i = fakeAutocomplete({ name: 'admin', sub: 'give', user: 'owner', focused: { name: 'dino-species', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toHaveLength(25);
  });

  it('responds [] for other focused options', async () => {
    const ctx = makeCtx();
    const i = fakeAutocomplete({ name: 'admin', sub: 'reset', user: 'owner', focused: { name: 'confirm', value: '' } });
    await cmd().autocomplete!(ctx, i.asAutocomplete());
    expect(i.replies[0]).toEqual([]);
  });
});
