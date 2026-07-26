import { z } from 'zod';

// Discord message/interaction payload limits, enforced on every payload the
// fake interactions record and on every payload the live sweep posts.
// Sources: Discord API docs (message + embed + component + autocomplete limits).

const toJson = (x: unknown): unknown =>
  x != null && typeof (x as { toJSON?: unknown }).toJSON === 'function'
    ? (x as { toJSON(): unknown }).toJSON() : x;

const fieldSchema = z.looseObject({
  name: z.string().min(1, 'field name empty').max(256, 'field name > 256'),
  value: z.string().min(1, 'field value empty').max(1024, 'field value > 1024'),
});
const embedSchema = z.looseObject({
  title: z.string().max(256, 'title > 256').optional(),
  description: z.string().max(4096, 'description > 4096').optional(),
  fields: z.array(fieldSchema).max(25, 'fields > 25').optional(),
  footer: z.looseObject({ text: z.string().max(2048, 'footer > 2048') }).optional(),
  author: z.looseObject({ name: z.string().max(256, 'author > 256') }).optional(),
});
const buttonSchema = z.looseObject({
  custom_id: z.string().max(100, 'custom_id > 100').optional(),
  label: z.string().max(80, 'label > 80').optional(),
});
const rowSchema = z.looseObject({
  components: z.array(buttonSchema).max(5, 'buttons per row > 5'),
});

type RawEmbed = z.infer<typeof embedSchema>;
function embedTextLength(e: RawEmbed): number {
  return (e.title?.length ?? 0) + (e.description?.length ?? 0)
    + (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0)
    + (e.fields ?? []).reduce((s, f) => s + f.name.length + f.value.length, 0);
}

function fail(source: string, msg: string): never {
  throw new Error(`${source}: ${msg}`);
}
function parseOr(source: string, what: string, schema: z.ZodType, value: unknown): unknown {
  const r = schema.safeParse(value);
  if (!r.success) fail(source, `${what} ${r.error.issues[0]?.message ?? 'invalid'}`);
  return r.data;
}

export function validateMessagePayload(payload: unknown, source: string): void {
  if (payload == null) fail(source, 'empty payload');
  if (typeof payload === 'string') {
    if (payload.length > 2000) fail(source, `content ${payload.length} > 2000`);
    return;
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.content === 'string' && p.content.length > 2000) {
    fail(source, `content ${p.content.length} > 2000`);
  }
  const embeds = Array.isArray(p.embeds) ? p.embeds.map(toJson) : [];
  if (embeds.length > 10) fail(source, `embeds ${embeds.length} > 10`);
  let total = 0;
  for (const e of embeds) {
    total += embedTextLength(parseOr(source, 'embed', embedSchema, e) as RawEmbed);
  }
  if (total > 6000) fail(source, `combined embed text ${total} > 6000`);
  const rows = Array.isArray(p.components) ? p.components.map(toJson) : [];
  if (rows.length > 5) fail(source, `component rows ${rows.length} > 5`);
  for (const r of rows) parseOr(source, 'row', rowSchema, r);
}

export function validateAutocompleteChoices(choices: unknown, source: string): void {
  if (!Array.isArray(choices)) fail(source, 'respond() payload is not an array');
  if (choices.length > 25) fail(source, `choices ${choices.length} > 25`);
  for (const c of choices as Array<Record<string, unknown>>) {
    const name = c?.name;
    if (typeof name !== 'string' || name.length < 1 || name.length > 100) {
      fail(source, `choice name must be a 1-100 char string (got ${JSON.stringify(name)})`);
    }
    const value = c?.value;
    if (typeof value === 'string' && value.length > 100) fail(source, `choice value > 100 chars`);
    if (typeof value !== 'string' && typeof value !== 'number') {
      fail(source, `choice value must be string|number`);
    }
  }
}
