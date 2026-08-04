import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { buildFilter, encodeGif, parseArgs } from '../scripts/make-gif.js';
import { gifInfo, BRANDING } from '../src/core/branding.js';

const run = promisify(execFile);
let dir: string;
let src: string;

// ffmpeg-static resolves to null on a platform it ships no binary for. Every
// test in this file either shells out to ffmpeg directly or exercises code
// that does, so the whole suite skips rather than letting beforeAll's
// execFile(null) crash the file (ffmpegPath as string would otherwise lie).
describe.skipIf(!ffmpegPath)('make-gif', () => {
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

    it('reverses and concatenates for a boomerang, resetting timestamps after the trim', () => {
      const f = buildFilter({ src: 'a.mp4', dest: 'b.gif', width: 512, height: 512, fps: 12, boomerang: true });
      expect(f).toContain('reverse');
      expect(f).toContain('concat');
      // Regression pin: without setpts=PTS-STARTPTS right after the trim, the
      // seam frame at the loop junction holds for roughly double the
      // surrounding delay instead of playing at the uniform fps.
      expect(f).toContain('trim=start_frame=1,setpts=PTS-STARTPTS');
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

    it('defaults fps to the avatar contract rate when --fps is omitted', () => {
      const o = parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height', '240']);
      expect(o.fps).toBe(BRANDING.avatar.fps);
    });

    it('throws when width or height is omitted entirely, rather than encoding scale=undefined', () => {
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '680'])).toThrow(/height/i);
      expect(() => parseArgs(['in.mp4', 'out.gif'])).toThrow(/width|height/i);
    });

    it('rejects an unknown flag', () => {
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height', '240', '--typo', '5']))
        .toThrow(/unknown flag.*--typo/i);
    });

    it('rejects the =-form of a flag rather than silently falling back to a default', () => {
      // This is the dangerous case: --fps=10 used to vanish entirely (it
      // starts with -- so it was excluded from positionals too), silently
      // keeping the 12 fps default and shipping an over-weight avatar.
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width=680', '--height', '240']))
        .toThrow(/unknown flag/i);
    });

    it('rejects a flag with no following token', () => {
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height']))
        .toThrow(/--height needs a value/i);
    });

    it('rejects a flag whose value is itself another flag', () => {
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height', '240', '--fps', '--boomerang']))
        .toThrow(/--fps needs a value/i);
    });

    it('rejects a non-numeric value instead of coercing it to NaN', () => {
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', 'abc', '--height', '240']))
        .toThrow(/--width must be a finite number/i);
    });

    it('rejects zero or negative width, height, and fps', () => {
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '0', '--height', '240']))
        .toThrow(/--width must be positive/i);
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height', '-240']))
        .toThrow(/--height must be positive/i);
      expect(() => parseArgs(['in.mp4', 'out.gif', '--width', '680', '--height', '240', '--fps', '0']))
        .toThrow(/--fps must be positive/i);
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

    it('encodes a boomerang loop as a valid multi-frame looping GIF at the requested size', async () => {
      const dest = join(dir, 'boomerang.gif');
      const res = await encodeGif({ src, dest, width: 64, height: 64, fps: 12, boomerang: true });
      const info = gifInfo(readFileSync(dest));
      expect(info.width).toBe(64);
      expect(info.height).toBe(64);
      expect(info.frames).toBeGreaterThan(1);
      expect(info.loopCount).toBe(0);
      expect(res.fps).toBe(12);
    }, 120_000);

    it('walks the frame-rate ladder down when the budget is tiny, keeping dimensions fixed', async () => {
      // A hardcoded budget is platform-fragile: the exact byte count for this
      // synthetic clip depends on the ffmpeg build doing the encoding. Instead,
      // measure this platform's actual 12 fps size first (default budget, so the
      // ladder can't engage), then constrain the real run to just under it — that
      // guarantees the first rung always exceeds budget and the ladder must step
      // down, whatever the platform produces.
      const full = await encodeGif({ src, dest: join(dir, 'tight-full.gif'), width: 128, height: 128, fps: 12 });
      const dest = join(dir, 'tight.gif');
      const res = await encodeGif({ src, dest, width: 128, height: 128, fps: 12, maxBytes: full.bytes - 1 });
      expect(res.fps).toBeLessThan(12);
      expect(gifInfo(readFileSync(dest)).width).toBe(128);
    }, 180_000);

    it('throws rather than shipping something over budget at the floor', async () => {
      const dest = join(dir, 'impossible.gif');
      await expect(encodeGif({ src, dest, width: 512, height: 512, fps: 12, maxBytes: 500 }))
        .rejects.toThrow(/8 fps|budget/i);
    }, 180_000);

    it('never overwrites an existing dest with a failed encode', async () => {
      const dest = join(dir, 'protected.gif');
      const sentinel = 'a previously committed asset that must survive a failed regeneration';
      writeFileSync(dest, sentinel);
      await expect(encodeGif({ src, dest, width: 512, height: 512, fps: 12, maxBytes: 500 }))
        .rejects.toThrow(/8 fps|budget/i);
      expect(readFileSync(dest, 'utf8')).toBe(sentinel);
    }, 180_000);
  });
});
