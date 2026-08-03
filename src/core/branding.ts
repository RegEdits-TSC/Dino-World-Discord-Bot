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
