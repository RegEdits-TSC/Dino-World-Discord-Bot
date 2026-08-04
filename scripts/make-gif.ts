import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
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
  // setpts=PTS-STARTPTS resets the reversed segment's timestamps after the
  // trim; without it the trimmed-off frame's duration is folded into the
  // frame that is now first, so the seam frame holds for roughly double the
  // surrounding delay instead of playing at the uniform fps.
  const source = o.boomerang
    ? `${base},split[fwd][rev];[rev]reverse,trim=start_frame=1,setpts=PTS-STARTPTS[revt];[fwd][revt]concat=n=2:v=1:a=0[cyc];[cyc]`
    : `${base}[cyc];[cyc]`;
  return `${source}split[a][b];[b]palettegen=stats_mode=diff[p];[a][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
}

export async function encodeGif(o: EncodeOptions): Promise<{ bytes: number; fps: number }> {
  const budget = o.maxBytes ?? BRANDING.maxBytes;
  // `-y` overwrites the moment ffmpeg starts writing, before the over-budget
  // throw below ever runs. Encoding to a scratch path and renaming onto dest
  // only on success means a failed regeneration can never replace a committed
  // asset with a bad one — the documented commands write straight into
  // assets/branding/*.gif. The scratch name keeps dest's own extension at the
  // end (a bare `.tmp` suffix makes ffmpeg unable to infer the GIF muxer).
  const tmpDest = join(dirname(o.dest), `.tmp-${basename(o.dest)}`);
  try {
    let fps: number | null = o.fps;
    while (fps !== null) {
      const opts = { ...o, fps };
      await run(ffmpegBin(), [
        '-y', '-i', o.src, '-filter_complex', buildFilter(opts), '-loop', '0', tmpDest,
      ], { maxBuffer: 64 * 1024 * 1024 });
      const bytes = statSync(tmpDest).size;
      if (bytes <= budget) {
        renameSync(tmpDest, o.dest);
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
  } finally {
    try { unlinkSync(tmpDest); } catch { /* renamed away on success, or never written on an early failure */ }
  }
}

const USAGE = 'Usage: make-gif <src.mp4> <dest.gif> --width N --height N [--fps N] ' +
  '[--crop-aspect N] [--boomerang] [--max-bytes N]';

const VALUED_FLAGS = new Set(['width', 'height', 'fps', 'crop-aspect', 'max-bytes']);
const POSITIVE_FLAGS = new Set(['width', 'height', 'fps']);

/**
 * This tool mints the committed avatar/banner GIFs, so a misparse ships a
 * wrong asset rather than failing loudly. Every `--` token is checked against
 * the known flag set (an unrecognised or `=`-form token like `--fps=10` is a
 * rejection, not a silent no-op that falls back to a default), every valued
 * flag requires a value that isn't itself another flag, and every numeric
 * value must parse to a finite number (positive, for width/height/fps).
 */
export function parseArgs(argv: string[]): EncodeOptions {
  const positionals: string[] = [];
  const values: Partial<Record<string, number>> = {};
  let boomerang = false;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (name === 'boomerang') {
      boomerang = true;
      continue;
    }
    if (!VALUED_FLAGS.has(name)) {
      throw new Error(`Unknown flag ${token}.\n${USAGE}`);
    }
    const raw = argv[i + 1];
    if (raw === undefined || raw.startsWith('--')) {
      throw new Error(`--${name} needs a value.\n${USAGE}`);
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw new Error(`--${name} must be a finite number, got "${raw}".\n${USAGE}`);
    }
    if (POSITIVE_FLAGS.has(name) && n <= 0) {
      throw new Error(`--${name} must be positive, got ${n}.\n${USAGE}`);
    }
    values[name] = n;
    i++;   // consume the value token so it is never mistaken for a positional
  }

  const [src, dest] = positionals;
  if (!src || !dest || positionals.length !== 2) throw new Error(USAGE);
  if (values.width === undefined || values.height === undefined) {
    throw new Error(`--width and --height are required.\n${USAGE}`);
  }

  return {
    src, dest,
    width: values.width, height: values.height,
    fps: values.fps ?? BRANDING.avatar.fps,
    cropAspect: values['crop-aspect'],
    boomerang,
    maxBytes: values['max-bytes'],
  };
}

// Only runs the CLI when invoked directly, so importing the helpers in a test
// never shells out to ffmpeg as a side effect of the import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await encodeGif(parseArgs(process.argv.slice(2)));
}
