# Animated Bot Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an animated GIF avatar and profile banner for the Dino World bot, plus the tooling to regenerate and re-apply them.

**Architecture:** Pure logic lives in `src/core/branding.ts` (GIF header parsing, budget ladder, upload guards) exactly as `src/core/emoji-sync.ts` holds the pure half of the emoji pipeline. Two thin I/O scripts consume it: `scripts/make-gif.ts` shells out to a bundled ffmpeg to convert Seedance MP4 into a palette-optimised looping GIF, and `src/deploy-branding.ts` PATCHes the bot's Discord profile and verifies the result. Art itself is generated through Higgsfield (Nano Banana Pro stills → Seedance 2.0 motion) in a dedicated task with human review gates.

**Tech Stack:** TypeScript (ESM NodeNext), tsx, vitest, discord.js REST, ffmpeg-static, Higgsfield MCP (`nano_banana_pro`, `seedance_2_0`).

**Spec:** `docs/superpowers/specs/2026-08-03-bot-branding-design.md`

## Global Constraints

- Branch: `bot-branding` (already created off `main`; the spec commit `7fa30fd` is its tip).
- ESM NodeNext: **every relative import carries a `.js` extension**, including in tests.
- Dependencies pin to current latest stable. `ffmpeg-static` is **5.3.0** (verified on npm 2026-08-03); re-verify before writing the version if time has passed.
- No attribution to AI, Claude, or any tool in commits, code comments, docs, or any other durable artifact. Commit messages match the repo's existing style: an imperative sentence, no `feat:`/`fix:` prefixes, no trailers.
- `assets/images/` is WebP-only, enforced by `tests/images.test.ts`. Branding GIFs go in `assets/branding/` — never under `assets/images/`.
- Discord hard limits: 10 MB per profile asset; profile edits are rate-limited to roughly 2/hour.
- Output dimensions are contract values: avatar **512×512**, banner **680×240**. The over-budget ladder lowers frame rate only, never dimensions.
- Never log the Discord token, request headers, or a raw API error body.
- TDD: every task that writes code writes the failing test first and runs it to watch it fail before implementing. Task 3 is the one exception — it produces art from a paid API, its gates are human review, and the machine-checkable properties of its output are asserted in Task 4.
- `npm run typecheck` (not `npm run build`) is the gate that typechecks `tests/` and `scripts/`. Run it before every commit that touches those directories.
- Intermediates (the Seedance MP4s, any downloaded still before cropping) go in the session scratchpad, never in the repo. This session's is `C:\Users\Claude\AppData\Local\Temp\claude\C--Users-Claude-Documents-GitHub-Dino-World-Discord-Bot\e947f12c-f7d5-45f0-97ff-88d28dbddf47\scratchpad`; a later session substitutes its own. The plan refers to it as `$SCRATCH`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/core/branding.ts` (create) | Pure helpers: GIF header parsing, frame-rate ladder, data URIs, upload guards, accepted-hash check, spec constants. No I/O, no network. |
| `scripts/make-gif.ts` (create) | CLI: MP4 → GIF via bundled ffmpeg, budget ladder loop, optional boomerang. Spawns processes; imports all decisions from `src/core/branding.ts`. |
| `src/deploy-branding.ts` (create) | CLI: PATCH `/users/@me` with avatar/banner data URIs, verify the returned hash is animated. |
| `tests/branding.test.ts` (create) | Unit tests for `src/core/branding.ts` plus assertions on the committed GIFs. |
| `tests/make-gif.test.ts` (create) | Integration test: encode a synthetic clip end-to-end with the real bundled ffmpeg. |
| `assets/branding/` (create) | `avatar.gif`, `banner.gif`, `icon.png`, `banner-still.png`. |
| `package.json` (modify) | Add `ffmpeg-static` devDep, `make-gif` and `deploy-branding` scripts. |
| `docs/assets/prompts.md` (modify) | Bot-branding section: prompts, params, ffmpeg reasoning, budgets. |
| `CLAUDE.md` (modify) | Conventions note for the branding pipeline. |

---

### Task 1: Pure branding helpers

**Files:**
- Create: `src/core/branding.ts`
- Test: `tests/branding.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface GifInfo { width: number; height: number; frames: number; loopCount: number | null }`
  - `gifInfo(buf: Buffer): GifInfo` — throws `Error` on a non-GIF buffer
  - `nextStep(fps: number): number | null` — next lower frame rate, `null` at the floor
  - `toDataUri(buf: Buffer, mime: string): string`
  - `assertUploadable(buf: Buffer, kind: 'gif' | 'png'): void` — throws on bad magic or oversize
  - `assertAnimatedAccepted(hash: string | null | undefined, which: string): void` — throws unless the hash starts with `a_`
  - `BRANDING = { avatar: { width: 512, height: 512, fps: 12 }, banner: { width: 680, height: 240, fps: 12 }, maxBytes: 8_388_608, discordMaxBytes: 10_485_760, fpsFloor: 8 }`

- [ ] **Step 1: Write the failing test**

Create `tests/branding.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  BRANDING, gifInfo, nextStep, toDataUri, assertUploadable, assertAnimatedAccepted,
} from '../src/core/branding.js';

// Hand-built GIF89a bytes. Assembling them here rather than committing a fixture
// keeps the parser honest: the test knows exactly which bytes mean what.
function buildGif(opts: { width: number; height: number; frames: number; loop?: number | null }): Buffer {
  const parts: number[] = [];
  parts.push(...Buffer.from('GIF89a', 'ascii'));
  parts.push(opts.width & 0xff, opts.width >> 8, opts.height & 0xff, opts.height >> 8);
  parts.push(0x80, 0x00, 0x00);                      // GCT present, 2 entries
  parts.push(0x00, 0x00, 0x00, 0xff, 0xff, 0xff);    // the 2-entry GCT itself
  if (opts.loop !== null && opts.loop !== undefined) {
    parts.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0', 'ascii'));
    parts.push(0x03, 0x01, opts.loop & 0xff, opts.loop >> 8, 0x00);
  }
  for (let i = 0; i < opts.frames; i++) {
    parts.push(0x21, 0xf9, 0x04, 0x00, 0x08, 0x00, 0x00, 0x00);   // graphic control ext
    parts.push(0x2c, 0, 0, 0, 0, opts.width & 0xff, opts.width >> 8, opts.height & 0xff, opts.height >> 8, 0x00);
    parts.push(0x02, 0x02, 0x44, 0x01, 0x00);                     // LZW min code size + 1 sub-block + terminator
  }
  parts.push(0x3b);
  return Buffer.from(parts);
}

describe('gifInfo', () => {
  it('reads dimensions, frame count and loop count', () => {
    const info = gifInfo(buildGif({ width: 512, height: 512, frames: 3, loop: 0 }));
    expect(info).toEqual({ width: 512, height: 512, frames: 3, loopCount: 0 });
  });

  it('reports a null loop count when no NETSCAPE block is present', () => {
    expect(gifInfo(buildGif({ width: 8, height: 8, frames: 2, loop: null })).loopCount).toBeNull();
  });

  it('counts a single-frame GIF as one frame — this is the silent-static failure mode', () => {
    expect(gifInfo(buildGif({ width: 680, height: 240, frames: 1, loop: 0 })).frames).toBe(1);
  });

  it('throws on a buffer that is not a GIF', () => {
    expect(() => gifInfo(Buffer.from('not a gif at all'))).toThrow(/not a GIF/i);
  });

  it('throws on a truncated GIF rather than returning a partial read', () => {
    const truncated = buildGif({ width: 64, height: 64, frames: 2, loop: 0 }).subarray(0, 9);
    expect(() => gifInfo(truncated)).toThrow();
  });
});

describe('nextStep', () => {
  it('steps 12 down to 10 and 10 down to 8', () => {
    expect(nextStep(12)).toBe(10);
    expect(nextStep(10)).toBe(8);
  });

  it('returns null at the floor so the ladder terminates', () => {
    expect(nextStep(BRANDING.fpsFloor)).toBeNull();
    expect(nextStep(4)).toBeNull();
  });

  it('terminates from any starting rate', () => {
    let fps: number | null = 12;
    const seen: number[] = [];
    while (fps !== null) { seen.push(fps); fps = nextStep(fps); }
    expect(seen).toEqual([12, 10, 8]);
  });
});

describe('toDataUri', () => {
  it('prefixes the mime type and base64-encodes the body', () => {
    expect(toDataUri(Buffer.from([0x00, 0x01]), 'image/gif')).toBe('data:image/gif;base64,AAE=');
  });
});

describe('assertUploadable', () => {
  const gif = buildGif({ width: 512, height: 512, frames: 2, loop: 0 });
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

  it('accepts a valid GIF and a valid PNG', () => {
    expect(() => assertUploadable(gif, 'gif')).not.toThrow();
    expect(() => assertUploadable(png, 'png')).not.toThrow();
  });

  it('rejects a buffer whose magic bytes do not match the declared kind', () => {
    expect(() => assertUploadable(png, 'gif')).toThrow(/magic/i);
    expect(() => assertUploadable(gif, 'png')).toThrow(/magic/i);
  });

  it("rejects a file over Discord's 10 MB ceiling", () => {
    const huge = Buffer.concat([gif, Buffer.alloc(BRANDING.discordMaxBytes)]);
    expect(() => assertUploadable(huge, 'gif')).toThrow(/10 MB|too large/i);
  });
});

describe('assertAnimatedAccepted', () => {
  it('accepts a hash carrying the a_ animated prefix', () => {
    expect(() => assertAnimatedAccepted('a_1234abcd', 'avatar')).not.toThrow();
  });

  it('rejects a static hash — Discord kept one frame', () => {
    expect(() => assertAnimatedAccepted('1234abcd', 'avatar')).toThrow(/static/i);
  });

  it('rejects a missing hash', () => {
    expect(() => assertAnimatedAccepted(null, 'banner')).toThrow(/banner/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/branding.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/branding.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/core/branding.ts`:

```typescript
export interface GifInfo {
  width: number;
  height: number;
  frames: number;
  /** Loop count from the NETSCAPE2.0 block; 0 means forever. null when absent. */
  loopCount: number | null;
}

export const BRANDING = {
  avatar: { width: 512, height: 512, fps: 12 },
  banner: { width: 680, height: 240, fps: 12 },
  maxBytes: 8_388_608,
  discordMaxBytes: 10_485_760,
  fpsFloor: 8,
} as const;

const MAGIC = {
  gif: [Buffer.from('GIF87a', 'ascii'), Buffer.from('GIF89a', 'ascii')],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
} as const;

/**
 * Minimal GIF header walker. Written by hand rather than pulled from a package
 * because the only thing being asserted is structural — dimensions, frame count
 * and the loop block — and a decoder dependency would be far more surface than
 * that needs.
 */
export function gifInfo(buf: Buffer): GifInfo {
  if (!MAGIC.gif.some((m) => buf.subarray(0, 6).equals(m))) {
    throw new Error('Buffer is not a GIF (bad magic bytes).');
  }
  if (buf.length < 13) throw new Error('Truncated GIF: header is incomplete.');

  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);
  const packed = buf[10];
  let p = 13;
  if (packed & 0x80) p += 3 * (1 << ((packed & 0x07) + 1));   // skip the global color table

  const skipSubBlocks = (at: number): number => {
    let i = at;
    for (;;) {
      if (i >= buf.length) throw new Error('Truncated GIF: unterminated data sub-blocks.');
      const size = buf[i];
      if (size === 0) return i + 1;
      i += size + 1;
    }
  };

  let frames = 0;
  let loopCount: number | null = null;
  for (;;) {
    if (p >= buf.length) throw new Error('Truncated GIF: no trailer byte.');
    const block = buf[p];
    if (block === 0x3b) break;                                  // trailer
    if (block === 0x21) {                                       // extension
      const label = buf[p + 1];
      if (label === 0xff && buf.subarray(p + 3, p + 14).toString('ascii') === 'NETSCAPE2.0') {
        loopCount = buf.readUInt16LE(p + 16);   // after the 11-byte identifier and the 0x03 0x01 sub-block header
      }
      p = skipSubBlocks(p + 2);                 // every extension type ends in a sub-block chain
      continue;
    }
    if (block === 0x2c) {                                       // image descriptor
      frames++;
      const lct = buf[p + 9];
      let q = p + 10;
      if (lct & 0x80) q += 3 * (1 << ((lct & 0x07) + 1));        // skip the local color table
      p = skipSubBlocks(q + 1);                                  // +1 for the LZW minimum code size
      continue;
    }
    throw new Error(`Unrecognised GIF block 0x${block.toString(16)} at byte ${p}.`);
  }
  return { width, height, frames, loopCount };
}

/**
 * The over-budget ladder lowers frame rate only. Dimensions are contract values
 * the tests assert exactly, and a canvas that shrank whenever a clip happened to
 * move more would make the committed asset's size non-deterministic.
 */
export function nextStep(fps: number): number | null {
  const next = fps - 2;
  return next >= BRANDING.fpsFloor ? next : null;
}

export function toDataUri(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString('base64')}`;
}

export function assertUploadable(buf: Buffer, kind: 'gif' | 'png'): void {
  if (!MAGIC[kind].some((m) => buf.subarray(0, m.length).equals(m))) {
    throw new Error(`Refusing to upload: magic bytes are not ${kind.toUpperCase()}.`);
  }
  if (buf.length > BRANDING.discordMaxBytes) {
    throw new Error(
      `Refusing to upload: ${(buf.length / 1e6).toFixed(1)} MB is over Discord's 10 MB ceiling.`,
    );
  }
}

/**
 * Discord prefixes an animated asset's hash with `a_`. Without this check a run
 * that silently stored a single static frame reports success.
 */
export function assertAnimatedAccepted(hash: string | null | undefined, which: string): void {
  if (!hash) throw new Error(`Discord returned no ${which} hash — the upload did not take.`);
  if (!hash.startsWith('a_')) {
    throw new Error(`Discord stored a static ${which} (hash ${hash}); the animation was dropped.`);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/branding.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/core/branding.ts tests/branding.test.ts
git commit -m "Add the pure branding helpers behind the animated profile assets"
```

---

### Task 2: MP4 to GIF encoder

**Files:**
- Create: `scripts/make-gif.ts`
- Modify: `package.json` (devDependency + `make-gif` script)
- Test: `tests/make-gif.test.ts`

**Interfaces:**
- Consumes: `BRANDING`, `gifInfo`, `nextStep` from `src/core/branding.js`.
- Produces:
  - `interface EncodeOptions { src: string; dest: string; width: number; height: number; fps: number; cropAspect?: number; boomerang?: boolean; maxBytes?: number }`
  - `buildFilter(o: EncodeOptions): string` — the ffmpeg `-filter_complex` string
  - `encodeGif(o: EncodeOptions): Promise<{ bytes: number; fps: number }>` — runs the ladder, throws below the floor
  - `parseArgs(argv: string[]): EncodeOptions`

- [ ] **Step 1: Install the dependency**

Run: `npm install --save-dev ffmpeg-static@5.3.0`
Then confirm 5.3.0 is still the latest stable: `npm view ffmpeg-static version`. If a newer stable exists, install that instead and use it everywhere below.

- [ ] **Step 2: Write the failing test**

Create `tests/make-gif.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { buildFilter, encodeGif, parseArgs } from '../scripts/make-gif.js';
import { gifInfo } from '../src/core/branding.js';

const run = promisify(execFile);
let dir: string;
let src: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'dw-gif-'));
  src = join(dir, 'src.mp4');
  // A synthetic 2s clip, so the test needs no committed fixture and no network.
  await run(ffmpegPath as string, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x640:rate=30:duration=2',
    '-pix_fmt', 'yuv420p', src,
  ]);
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('buildFilter', () => {
  it('emits a diff palette and ordered dithering, which is what keeps the file small', () => {
    const f = buildFilter({ src: 'a.mp4', dest: 'b.gif', width: 512, height: 512, fps: 12 });
    expect(f).toContain('fps=12');
    expect(f).toContain('scale=512:512:flags=lanczos');
    expect(f).toContain('palettegen=stats_mode=diff');
    expect(f).toContain('paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle');
  });

  it('crops to the requested aspect before scaling when one is given', () => {
    const f = buildFilter({ src: 'a.mp4', dest: 'b.gif', width: 680, height: 240, fps: 12, cropAspect: 2.8333 });
    expect(f).toMatch(/crop=in_w:in_w\/2\.8333.*scale=680:240/);
  });

  it('omits the crop entirely when no aspect is given', () => {
    expect(buildFilter({ src: 'a.mp4', dest: 'b.gif', width: 512, height: 512, fps: 12 })).not.toContain('crop=');
  });

  it('reverses and concatenates for a boomerang', () => {
    const f = buildFilter({ src: 'a.mp4', dest: 'b.gif', width: 512, height: 512, fps: 12, boomerang: true });
    expect(f).toContain('reverse');
    expect(f).toContain('concat');
  });
});

describe('parseArgs', () => {
  it('reads paths and flags', () => {
    const o = parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height', '240',
      '--fps', '10', '--crop-aspect', '2.8333', '--boomerang']);
    expect(o).toMatchObject({
      src: 'in.mp4', dest: 'out.gif', width: 680, height: 240,
      fps: 10, cropAspect: 2.8333, boomerang: true,
    });
  });

  it('throws when the source or destination is missing', () => {
    expect(() => parseArgs(['only-one.mp4'])).toThrow(/usage/i);
  });
});

describe('encodeGif', () => {
  it('writes a looping multi-frame GIF at exactly the requested size', async () => {
    const dest = join(dir, 'out.gif');
    const res = await encodeGif({ src, dest, width: 128, height: 128, fps: 12 });
    const info = gifInfo(readFileSync(dest));
    expect(info.width).toBe(128);
    expect(info.height).toBe(128);
    expect(info.frames).toBeGreaterThan(1);
    expect(info.loopCount).toBe(0);
    expect(res.fps).toBe(12);
  }, 120_000);

  it('crops to the banner aspect without distorting the scale', async () => {
    const dest = join(dir, 'wide.gif');
    await encodeGif({ src, dest, width: 680, height: 240, fps: 10, cropAspect: 2.8333 });
    const info = gifInfo(readFileSync(dest));
    expect(info.width).toBe(680);
    expect(info.height).toBe(240);
  }, 120_000);

  it('walks the frame-rate ladder down when the budget is tiny, keeping dimensions fixed', async () => {
    const dest = join(dir, 'tight.gif');
    const res = await encodeGif({ src, dest, width: 128, height: 128, fps: 12, maxBytes: 20_000 });
    expect(res.fps).toBeLessThan(12);
    expect(gifInfo(readFileSync(dest)).width).toBe(128);
  }, 180_000);

  it('throws rather than shipping something over budget at the floor', async () => {
    const dest = join(dir, 'impossible.gif');
    await expect(encodeGif({ src, dest, width: 512, height: 512, fps: 12, maxBytes: 500 }))
      .rejects.toThrow(/8 fps|budget/i);
  }, 180_000);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/make-gif.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/make-gif.js"`.

- [ ] **Step 4: Write the implementation**

Create `scripts/make-gif.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { BRANDING, nextStep } from '../src/core/branding.js';

const run = promisify(execFile);

// ffmpeg-static resolves to null on a platform it ships no binary for, and the
// failure is otherwise a confusing spawn error deep inside encodeGif.
function ffmpegBin(): string {
  if (!ffmpegPath) {
    throw new Error(
      'No ffmpeg binary available. Run `npm install` to restore ffmpeg-static, or install ffmpeg ' +
      'and point this script at it.',
    );
  }
  return ffmpegPath;
}

export interface EncodeOptions {
  src: string;
  dest: string;
  width: number;
  height: number;
  fps: number;
  cropAspect?: number;
  boomerang?: boolean;
  maxBytes?: number;
}

/**
 * stats_mode=diff spends the 256-colour budget on pixels that actually move, and
 * diff_mode=rectangle leaves the static regions byte-identical between frames —
 * together they are where nearly all of the compression on an ambient loop comes
 * from. bayer rather than the default error diffusion because Floyd-Steinberg
 * re-dithers the static background differently every frame, destroying that
 * redundancy and visibly shimmering on flat gradients.
 */
export function buildFilter(o: EncodeOptions): string {
  const crop = o.cropAspect ? `crop=in_w:in_w/${o.cropAspect},` : '';
  const base = `fps=${o.fps},${crop}scale=${o.width}:${o.height}:flags=lanczos`;
  const source = o.boomerang
    ? `${base},split[fwd][rev];[rev]reverse,trim=start_frame=1[revt];[fwd][revt]concat=n=2:v=1:a=0[cyc];[cyc]`
    : `${base}[cyc];[cyc]`;
  return `${source}split[a][b];[b]palettegen=stats_mode=diff[p];[a][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
}

export async function encodeGif(o: EncodeOptions): Promise<{ bytes: number; fps: number }> {
  const budget = o.maxBytes ?? BRANDING.maxBytes;
  let fps: number | null = o.fps;
  while (fps !== null) {
    const opts = { ...o, fps };
    await run(ffmpegBin(), [
      '-y', '-i', o.src, '-filter_complex', buildFilter(opts), '-loop', '0', o.dest,
    ], { maxBuffer: 64 * 1024 * 1024 });
    const bytes = statSync(o.dest).size;
    if (bytes <= budget) {
      console.log(`${o.dest}: ${(bytes / 1e6).toFixed(2)} MB at ${fps} fps.`);
      return { bytes, fps };
    }
    const lower: number | null = nextStep(fps);
    console.log(
      `${o.dest}: ${(bytes / 1e6).toFixed(2)} MB exceeds budget at ${fps} fps` +
      `${lower === null ? '' : ` — retrying at ${lower} fps`}.`,
    );
    fps = lower;
  }
  throw new Error(
    `${o.dest} is still over budget at ${BRANDING.fpsFloor} fps. That is a signal about the clip, ` +
    'not the encoder: the motion is broader than the subtle-ambient direction called for. Reroll it.',
  );
}

export function parseArgs(argv: string[]): EncodeOptions {
  const [src, dest] = argv.filter((a) => !a.startsWith('--') && !/^[\d.]+$/.test(a));
  if (!src || !dest) {
    throw new Error('Usage: make-gif <src.mp4> <dest.gif> --width N --height N [--fps N] ' +
      '[--crop-aspect N] [--boomerang] [--max-bytes N]');
  }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const num = (name: string, fallback?: number): number | undefined => {
    const v = flag(name);
    return v === undefined ? fallback : Number(v);
  };
  return {
    src, dest,
    width: num('width')!, height: num('height')!,
    fps: num('fps', BRANDING.avatar.fps)!,
    cropAspect: num('crop-aspect'),
    boomerang: argv.includes('--boomerang'),
    maxBytes: num('max-bytes'),
  };
}

// Only runs the CLI when invoked directly, so importing the helpers in a test
// never shells out to ffmpeg as a side effect of the import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await encodeGif(parseArgs(process.argv.slice(2)));
}
```

- [ ] **Step 5: Add the npm script**

In `package.json`, inside `"scripts"`, after `"deploy-emojis"`:

```json
    "make-gif": "tsx scripts/make-gif.ts"
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/make-gif.test.ts`
Expected: PASS. The ladder and floor cases each run several ffmpeg passes, so allow a couple of minutes.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `ffmpeg-static` has no bundled types, add `"allowJs": false` is **not** the fix — instead confirm the package ships `index.d.ts`; if it does not, declare the module in `src/types/ffmpeg-static.d.ts` with `declare module 'ffmpeg-static' { const path: string | null; export default path; }` and include that file.

- [ ] **Step 8: Commit**

```bash
git add scripts/make-gif.ts tests/make-gif.test.ts package.json package-lock.json
git commit -m "Add the MP4 to looping GIF encoder for the profile assets"
```

---

### Task 3: Generate the art

**Files:**
- Create: `assets/branding/icon.png`, `assets/branding/banner-still.png`
- Scratch only (not committed): `$SCRATCH/avatar.mp4`, `$SCRATCH/banner.mp4`

No test in this task — its output is images, and the machine-checkable properties are asserted in Task 4 once the GIFs exist. The gates here are human review.

**Interfaces:**
- Produces: `$SCRATCH/avatar.mp4` and `$SCRATCH/banner.mp4`, consumed by Task 4; two committed PNG stills.

- [ ] **Step 1: Load the Higgsfield tools**

`ToolSearch` with `select:mcp__claude_ai_Higgsfield__media_upload,mcp__claude_ai_Higgsfield__media_confirm,mcp__claude_ai_Higgsfield__generate_image,mcp__claude_ai_Higgsfield__generate_video,mcp__claude_ai_Higgsfield__job_status`

- [ ] **Step 2: Upload the reference cutout**

Call `media_upload` with `filename: "bruiser-carnivore.webp"`, PUT the bytes of `assets/images/dinos/bruiser-carnivore.webp` to the returned `upload_url`, then `media_confirm`. Keep the returned `media_id`.

- [ ] **Step 3: Generate the avatar still**

`generate_image` with `model: "nano_banana_pro"`, `aspect_ratio: "1:1"`, `medias: [{ role: "image_references", value: "<media_id>" }]`, and the prompt verbatim from the spec's "Stage 1 — stills" section (avatar still).

- [ ] **Step 4: Generate the banner still**

`generate_image` with `model: "nano_banana_pro"`, `aspect_ratio: "21:9"` and the banner still prompt verbatim from the spec.

- [ ] **Step 5: Review gate — stills**

Show both to the user. Check: the T-rex reads as the same character as the committed cutout; its head sits inside the avatar's inscribed circle; the banner's left third has no focal subject; the banner has visible dead headroom top and bottom for the 2.83:1 crop. Reroll any that fail (2 credits each) before spending video credits.

- [ ] **Step 6: Animate the avatar**

`generate_video` with `model: "seedance_2_0"`, `aspect_ratio: "1:1"`, `duration: 5`, `resolution: "720p"`, `mode: "std"`, `generate_audio: false`, `use_unlim: true`, `medias: [{ role: "start_image", value: "<avatar still job_id>" }, { role: "end_image", value: "<avatar still job_id>" }]`, and the avatar motion prompt verbatim from the spec.

If the request is rejected for unlim, **stop and report the rejection reason to the user**. Do not silently re-run on credits — 22.5 credits is the user's call.

- [ ] **Step 7: Animate the banner**

Same call with `aspect_ratio: "21:9"`, `resolution: "1080p"`, and the banner motion prompt. Same unlim rule (45 credits).

- [ ] **Step 8: Review gate — motion**

Show both clips. Check the first and last frame match, the camera never moves, and nothing enters or leaves frame. One reroll with harder camera-lock wording is allowed; a second failure means Task 4 encodes with `--boomerang`.

- [ ] **Step 9: Save the stills**

Download both stills to `assets/branding/icon.png` (1024×1024) and `assets/branding/banner-still.png` (1360×480, the 2.83:1 centre crop). If either arrives smaller than its target, upscale once with Lanczos rather than regenerating — these are fallback assets, not embed art:

```bash
npx tsx -e "import ffmpeg from 'ffmpeg-static'; import {execFileSync} from 'node:child_process'; execFileSync(ffmpeg, ['-y','-i','<in>','-vf','scale=1024:1024:flags=lanczos','assets/branding/icon.png'])"
```

- [ ] **Step 10: Commit the stills**

```bash
git add assets/branding/icon.png assets/branding/banner-still.png
git commit -m "Add the static bot icon and banner stills"
```

---

### Task 4: Encode and commit the GIFs

**Files:**
- Create: `assets/branding/avatar.gif`, `assets/branding/banner.gif`
- Modify: `tests/branding.test.ts` (append the committed-asset block)

**Interfaces:**
- Consumes: `encodeGif` from `scripts/make-gif.js`, `gifInfo` and `BRANDING` from `src/core/branding.js`, the two MP4s from Task 3.

- [ ] **Step 1: Write the failing test**

Append the block below to `tests/branding.test.ts`, merging these two lines into the file's existing import block at the top rather than leaving them mid-file:

```typescript
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
```

```typescript
describe('the committed branding assets', () => {
  // These are the properties a visual review cannot catch: a GIF that Discord
  // will reject at upload, or one that silently exported a single static frame.
  const cases = [
    { file: 'avatar.gif', spec: BRANDING.avatar },
    { file: 'banner.gif', spec: BRANDING.banner },
  ] as const;

  it.each(cases)('$file is a looping multi-frame GIF at its contract size', ({ file, spec }) => {
    const path = resolve(process.cwd(), 'assets/branding', file);
    const info = gifInfo(readFileSync(path));
    expect(info.width).toBe(spec.width);
    expect(info.height).toBe(spec.height);
    expect(info.frames, 'a single frame means the export silently lost its animation').toBeGreaterThan(1);
    expect(info.loopCount, 'must loop forever').toBe(0);
  });

  it.each(cases)('$file is within budget and under the Discord ceiling', ({ file }) => {
    const bytes = statSync(resolve(process.cwd(), 'assets/branding', file)).size;
    expect(bytes).toBeLessThanOrEqual(BRANDING.maxBytes);
    expect(bytes).toBeLessThan(BRANDING.discordMaxBytes);
  });

  it('ships the static fallbacks alongside them', () => {
    for (const file of ['icon.png', 'banner-still.png']) {
      const buf = readFileSync(resolve(process.cwd(), 'assets/branding', file));
      expect(() => assertUploadable(buf, 'png'), file).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/branding.test.ts`
Expected: FAIL — `ENOENT` on `assets/branding/avatar.gif`.

- [ ] **Step 3: Encode both GIFs**

```bash
npm run make-gif -- "$SCRATCH/avatar.mp4" assets/branding/avatar.gif --width 512 --height 512 --fps 12
npm run make-gif -- "$SCRATCH/banner.mp4" assets/branding/banner.gif --width 680 --height 240 --fps 12 --crop-aspect 2.8333
```

Add `--boomerang` to either command if Task 3's motion review failed twice.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/branding.test.ts`
Expected: PASS.

- [ ] **Step 5: Review gate — encoded output**

Open both GIFs and show them to the user. Check for banding across the volcano gradient and for a visible seam at the loop point. If banding is bad, the fix is a still reroll with basalt grain and ash texture added to the prompt (a broken-up ramp quantises far better than a clean one), not an encoder change.

- [ ] **Step 6: Commit**

```bash
git add assets/branding/avatar.gif assets/branding/banner.gif tests/branding.test.ts
git commit -m "Add the animated bot avatar and profile banner"
```

---

### Task 5: Apply to Discord

**Files:**
- Create: `src/deploy-branding.ts`
- Modify: `package.json` (`deploy-branding` script)
- Modify: `tests/branding.test.ts` (append the selection block)

**Interfaces:**
- Consumes: `toDataUri`, `assertUploadable`, `assertAnimatedAccepted` from `src/core/branding.js`; `loadConfig` from `src/core/config.js`.
- Produces: `selectAssets(argv: string[]): Array<'avatar' | 'banner'>`

- [ ] **Step 1: Write the failing test**

Append the block below to `tests/branding.test.ts`, again merging the import into the file's existing import block:

```typescript
import { selectAssets } from '../src/deploy-branding.js';
```

```typescript
describe('selectAssets', () => {
  // Profile edits are rate-limited to roughly 2/hour, so re-uploading one asset
  // must not spend the budget for both.
  it('sends both by default', () => {
    expect(selectAssets([])).toEqual(['avatar', 'banner']);
  });

  it('honours --avatar-only and --banner-only', () => {
    expect(selectAssets(['--avatar-only'])).toEqual(['avatar']);
    expect(selectAssets(['--banner-only'])).toEqual(['banner']);
  });

  it('rejects both flags at once rather than silently picking one', () => {
    expect(() => selectAssets(['--avatar-only', '--banner-only'])).toThrow(/both/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/branding.test.ts`
Expected: FAIL — cannot resolve `../src/deploy-branding.js`.

- [ ] **Step 3: Write the implementation**

Create `src/deploy-branding.ts`:

```typescript
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './core/config.js';
import { assertAnimatedAccepted, assertUploadable, toDataUri } from './core/branding.js';

export type Asset = 'avatar' | 'banner';

export function selectAssets(argv: string[]): Asset[] {
  const avatarOnly = argv.includes('--avatar-only');
  const bannerOnly = argv.includes('--banner-only');
  if (avatarOnly && bannerOnly) {
    throw new Error('Pass --avatar-only or --banner-only, not both (omit both to send each).');
  }
  if (avatarOnly) return ['avatar'];
  if (bannerOnly) return ['banner'];
  return ['avatar', 'banner'];
}

async function main(): Promise<void> {
  const config = loadConfig();
  const rest = new REST().setToken(config.token);
  const assets = selectAssets(process.argv.slice(2));

  const body: Record<string, string> = {};
  for (const asset of assets) {
    const buf = readFileSync(resolve(process.cwd(), 'assets/branding', `${asset}.gif`));
    assertUploadable(buf, 'gif');
    body[asset] = toDataUri(buf, 'image/gif');
  }

  let res: { avatar?: string | null; banner?: string | null };
  try {
    res = await rest.patch(Routes.user(), { body }) as typeof res;
  } catch (err) {
    // Status and Discord's error code only. An API error body can echo request
    // context back, and the request carries the bot token.
    const e = err as { status?: number; code?: number; rawError?: { retry_after?: number } };
    if (e.status === 429) {
      const wait = e.rawError?.retry_after;
      throw new Error(
        `Rate limited (429)${wait ? `, retry after ${wait}s` : ''}. ` +
        'Discord allows roughly two profile edits per hour — use --avatar-only or --banner-only.',
      );
    }
    throw new Error(`Profile update failed: HTTP ${e.status ?? '?'}, Discord code ${e.code ?? '?'}.`);
  }

  for (const asset of assets) assertAnimatedAccepted(res[asset], asset);
  console.log(`Updated ${assets.join(' and ')} — Discord confirmed each as animated.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
```

- [ ] **Step 4: Add the npm script**

In `package.json`, inside `"scripts"`, after `"make-gif"`:

```json
    "deploy-branding": "tsx src/deploy-branding.ts"
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/branding.test.ts`
Expected: PASS. Importing the module must not hit the network — the direct-invocation guard is what prevents that; if the suite hangs or errors on a missing `DISCORD_TOKEN`, the guard is wrong.

- [ ] **Step 6: Typecheck and full suite**

Run: `npm run typecheck` then `npm test`
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
git add src/deploy-branding.ts tests/branding.test.ts package.json
git commit -m "Add the deploy-branding script for the bot profile assets"
```

---

### Task 6: Documentation and final verification

**Files:**
- Modify: `docs/assets/prompts.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add the prompts section**

Append a `## Bot branding (animated avatar and banner)` section to `docs/assets/prompts.md` containing, verbatim from the spec: both still prompts, the reference chain off `assets/images/dinos/bruiser-carnivore.webp`, both motion prompts, the Seedance parameter table, the ffmpeg filter chain with the reasoning for `stats_mode=diff`, `diff_mode=rectangle` and `bayer`, the file targets table, and the 8 MB budget with its frame-rate ladder. Include the two `npm run make-gif` command lines from Task 4 so the assets are reproducible from the doc alone.

- [ ] **Step 2: Add the conventions note**

Append to `CLAUDE.md`:

```markdown
- Bot profile branding lives in `assets/branding/` — **not** `assets/images/`, whose
  every file must be WebP (`tests/images.test.ts`). Discord takes GIF only for an
  animated avatar or banner, at 512×512 and 680×240; those dimensions are contract
  values asserted in `tests/branding.test.ts`, so `scripts/make-gif.ts`'s over-budget
  ladder lowers frame rate (12 → 10 → 8) and never the canvas. `npm run deploy-branding`
  is an operator step, not part of any build: Discord rate-limits profile edits to
  roughly 2/hour, hence `--avatar-only` / `--banner-only`. It asserts the returned
  asset hash starts with `a_` — Discord's own confirmation that it stored the
  animation rather than a single static frame, which is otherwise a silent failure.
  Regeneration prompts and the ffmpeg flag reasoning are in `docs/assets/prompts.md`.
```

- [ ] **Step 3: Confirm `.env.example` needs no change**

`deploy-branding` reuses the existing `DISCORD_TOKEN` through `loadConfig()` and introduces no new variable. Open `.env.example`, confirm nothing is missing, and leave it untouched — this step exists so the absence is a checked decision rather than an oversight.

- [ ] **Step 4: Verify the full gate**

Run: `npm test`, then `npm run typecheck`, then `npm run build`
Expected: all three clean.

- [ ] **Step 5: Commit**

```bash
git add docs/assets/prompts.md CLAUDE.md
git commit -m "Document the bot branding pipeline and its conventions"
```

- [ ] **Step 6: Hand off the operator step**

Report to the user that `npm run deploy-branding` is theirs to run (it mutates the live bot profile and is rate-limited), and that the client should be checked afterwards for the animated avatar in a chat list and the banner on the bot's profile popout.

---

## Notes for the implementer

- The `assets/branding/` GIFs are binary and land in git history at their committed size. Both are budgeted to 8 MB, and in practice an ambient loop with a diff palette lands far under that; if either is close to the budget, that is worth flagging rather than accepting.
- Task 3 spends real money (or a free-trial allowance) on someone else's account. Never re-run a rejected unlim request on credits without asking.
- `tests/make-gif.test.ts` shells out to a real ffmpeg several times and is the slowest file in the suite by a wide margin. That is deliberate — the encoder's contract is the bytes it produces, and a mocked ffmpeg would assert nothing.
