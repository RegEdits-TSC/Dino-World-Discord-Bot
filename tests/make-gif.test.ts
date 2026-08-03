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
    // testsrc's scrolling gradient touches nearly the whole frame every tick, so
    // diff_mode=rectangle buys little on this clip: 128x128 measures ~42 KB at 12
    // fps down to ~31 KB at the 8 fps floor. The budget below is picked under that
    // floor so the ladder must walk all the way down and still land successfully.
    const res = await encodeGif({ src, dest, width: 128, height: 128, fps: 12, maxBytes: 35_000 });
    expect(res.fps).toBeLessThan(12);
    expect(gifInfo(readFileSync(dest)).width).toBe(128);
  }, 180_000);

  it('throws rather than shipping something over budget at the floor', async () => {
    const dest = join(dir, 'impossible.gif');
    await expect(encodeGif({ src, dest, width: 512, height: 512, fps: 12, maxBytes: 500 }))
      .rejects.toThrow(/8 fps|budget/i);
  }, 180_000);
});
