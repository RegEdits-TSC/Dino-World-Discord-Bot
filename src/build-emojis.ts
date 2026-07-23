import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderSvg } from './core/render-svg.js';

const SVG_DIR = resolve(process.cwd(), 'assets/emojis/svg');
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');
const EMOJI_SIZE = 128;

mkdirSync(PNG_DIR, { recursive: true });
const files = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg')).sort();
for (const f of files) {
  const png = renderSvg(readFileSync(resolve(SVG_DIR, f)), EMOJI_SIZE);
  writeFileSync(resolve(PNG_DIR, f.replace('.svg', '.png')), png);
}
console.log(`Rendered ${files.length} emoji PNGs to assets/emojis/png/.`);
