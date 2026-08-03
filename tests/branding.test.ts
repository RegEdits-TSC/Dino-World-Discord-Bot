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
