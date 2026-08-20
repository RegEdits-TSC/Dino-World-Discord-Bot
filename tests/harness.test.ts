import { describe, it, expect } from 'vitest';
import { makeCtx, fakeCommand, fakeAutocomplete, fakeButton, fakeSelect, mulberry32, replyText } from './harness.js';

describe('harness', () => {
  it('ctx time is controllable and rng deterministic', () => {
    const ctx = makeCtx();
    ctx.setNow(1234); expect(ctx.now()).toBe(1234);
    const a = mulberry32(7)(); const b = mulberry32(7)();
    expect(a).toBe(b);
  });
  it('ctx.sleep is an instant stub in tests', async () => {
    const ctx = makeCtx();
    const start = Date.now();
    await ctx.sleep(60_000);
    expect(Date.now() - start).toBeLessThan(1_000);   // resolves immediately, never waits a minute
  });
  it('fake interaction records replies', async () => {
    const i = fakeCommand({ name: 'park', sub: 'view', user: 'u1' });
    await i.asChatInput().reply({ content: 'hi' });
    expect(i.replies).toEqual([{ content: 'hi' }]);
  });
  it('reply after reply throws InteractionAlreadyReplied', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await i.reply({ content: 'one' });
    await expect(i.reply({ content: 'two' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('reply after deferReply throws InteractionAlreadyReplied', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await i.deferReply();
    await expect(i.reply({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('editReply and followUp before any ack throw InteractionNotReplied', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await expect(i.editReply({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionNotReplied' });
    await expect(i.followUp({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionNotReplied' });
  });
  it('defer then editReply works and records defer options', async () => {
    const fi = fakeCommand({ name: 'zzz-test', user: 'u1' });
    const i = fi.asChatInput();
    await i.deferReply();
    await i.editReply({ content: 'later' });
    expect(fi.replies).toEqual([{ content: 'later' }]);
    expect(fi.deferOpts).toHaveLength(1);
    expect(i.deferred).toBe(true);
    expect(i.replied).toBe(true);
  });
  it('double deferReply throws', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await i.deferReply();
    await expect(i.deferReply()).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  it('button update enforces the same lifecycle and exposes message', async () => {
    const fb = fakeButton({ customId: 'x:y:1', user: 'u1' });
    const b = fb.asInteraction() as unknown as {
      update(p: unknown): Promise<void>; deferUpdate(): Promise<void>; message: { id: string };
    };
    expect(b.message.id).toBeTruthy();
    await b.update({ content: 'edited' });
    await expect(b.update({ content: 'again' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
    const fb2 = fakeButton({ customId: 'x:y:2', user: 'u1' });
    const b2 = fb2.asInteraction() as unknown as { deferUpdate(): Promise<void>; update(p: unknown): Promise<void> };
    await b2.deferUpdate();
    await expect(b2.update({ content: 'x' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });
  // Load-bearing since the router-level component guard shipped (src/core/router.ts):
  // 87 fakeButton sites call execute directly and never state componentIds, so this
  // default is what models "the button you clicked is one the message actually carries"
  // for all of them. A fixture opts out with [] (or somebody else's ids) to model a
  // forged customId emitted straight at the gateway.
  it('fakeButton defaults componentIds to the clicked id, and [] mints a message with none', () => {
    const idsOn = (fb: ReturnType<typeof fakeButton>) =>
      (fb.asInteraction() as unknown as {
        message: { components: Array<{ components: Array<{ customId: string }> }> };
      }).message.components.flatMap((r) => r.components.map((c) => c.customId));
    expect(idsOn(fakeButton({ customId: 'x:y:1', user: 'u1' }))).toEqual(['x:y:1']);
    expect(idsOn(fakeButton({ customId: 'x:y:1', user: 'u1', componentIds: [] }))).toEqual([]);
    expect(idsOn(fakeButton({ customId: 'x:y:1', user: 'u1', componentIds: ['a:b', 'c:d'] })))
      .toEqual(['a:b', 'c:d']);
  });
  it('recorded payloads are validated against Discord limits', async () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1' }).asChatInput();
    await expect(i.reply({ content: 'x'.repeat(2001) })).rejects.toThrow(/content/);
  });
  it('replyText extracts content from both payload forms', () => {
    expect(replyText('plain')).toBe('plain');
    expect(replyText({ content: 'obj' })).toBe('obj');
    expect(replyText({ embeds: [] })).toBe('');
  });
  it('rejects an option name the builder does not define', () => {
    expect(() => fakeCommand({ name: 'incubate', user: 'u1', options: { egg: 1, speces: 'typo' } }))
      .toThrow(/speces/);
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: 1 } }).asChatInput();
    expect(() => i.options.getString('nope')).toThrow(/not defined/);
  });
  it('rejects a getter whose type disagrees with the builder', () => {
    const i = fakeCommand({ name: 'incubate', user: 'u1', options: { egg: 1 } }).asChatInput();
    expect(() => i.options.getString('egg')).toThrow(/type/);   // egg is an Integer option
    expect(i.options.getInteger('egg')).toBe(1);
  });
  it('required getter throws when the fixture omits the option', () => {
    const i = fakeCommand({ name: 'incubate', user: 'u1' }).asChatInput();
    expect(() => i.options.getInteger('egg', true)).toThrow(/Required option/);
    expect(i.options.getInteger('egg')).toBeNull();
  });
  it('enforces subcommand names against the builder', () => {
    expect(() => fakeCommand({ name: 'shop', user: 'u1' })).toThrow(/subcommand/);
    expect(() => fakeCommand({ name: 'shop', sub: 'nope', user: 'u1' })).toThrow(/nope/);
    expect(() => fakeCommand({ name: 'incubate', sub: 'extra', user: 'u1', options: { egg: 1 } }))
      .toThrow(/no subcommands/);
  });
  it('keeps permissive mode for synthetic commands unknown to the registry', () => {
    const i = fakeCommand({ name: 'zzz-test', user: 'u1', options: { anything: 'goes' } }).asChatInput();
    expect(i.options.getString('anything')).toBe('goes');
  });
  it('autocomplete fake rejects a focused option without the builder flag', () => {
    expect(() => fakeAutocomplete({ name: 'expedition', sub: 'start', user: 'u1', focused: { name: 'site', value: '' } }))
      .not.toThrow();
    expect(() => fakeAutocomplete({ name: 'top', user: 'u1', focused: { name: 'metric', value: '' } }))
      .toThrow(/autocomplete/);
  });
  it('autocomplete respond() is once-only and validated', async () => {
    const fa = fakeAutocomplete({ name: 'incubate', user: 'u1', focused: { name: 'egg', value: '' } });
    const a = fa.asAutocomplete();
    await a.respond([]);
    await expect(a.respond([])).rejects.toThrow(/already responded/);
  });
});

describe('fakeSelect', () => {
  it('defaults componentIds to the clicked id, like fakeButton', () => {
    const s = fakeSelect({ customId: 'park:build:u1', user: 'u1', values: ['gene_lab'] });
    const raw = s.asInteraction() as unknown as {
      message: { components: Array<{ components: Array<{ type: number; customId: string }> }> };
    };
    expect(raw.message.components[0].components[0]).toMatchObject({ type: 3, customId: 'park:build:u1' });
  });

  it('models a forged value by letting options and values diverge', () => {
    const s = fakeSelect({
      customId: 'park:build:u1', user: 'u1', values: ['__proto__'], options: ['gene_lab'],
    });
    const raw = s.asInteraction() as unknown as {
      values: string[];
      message: { components: Array<{ components: Array<{ options: Array<{ value: string }> }> }> };
    };
    expect(raw.values).toEqual(['__proto__']);
    expect(raw.message.components[0].components[0].options).toEqual([{ value: 'gene_lab', label: 'gene_lab' }]);
  });

  it('discriminates the two defers, like fakeButton', async () => {
    const s = fakeSelect({ customId: 'x:y', user: 'u1', values: ['a'] });
    const raw = s.asInteraction() as unknown as { deferUpdate(): Promise<void> };
    await raw.deferUpdate();
    expect(s.deferOpts).toEqual([{ kind: 'update' }]);
  });

  it('enforces reply-once', async () => {
    const s = fakeSelect({ customId: 'x:y', user: 'u1', values: ['a'] });
    const raw = s.asInteraction() as unknown as { reply(p: unknown): Promise<void> };
    await raw.reply({ content: 'one' });
    await expect(raw.reply({ content: 'two' })).rejects.toMatchObject({ code: 'InteractionAlreadyReplied' });
  });

  it('reports itself as a select and not as a button', () => {
    const raw = fakeSelect({ customId: 'x:y', user: 'u1', values: ['a'] })
      .asInteraction() as unknown as { isButton(): boolean; isStringSelectMenu(): boolean };
    expect(raw.isButton()).toBe(false);
    expect(raw.isStringSelectMenu()).toBe(true);
  });
});
