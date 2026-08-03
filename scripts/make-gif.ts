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
