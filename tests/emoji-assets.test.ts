import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas, Image } from '@napi-rs/canvas';
import { renderSvg } from '../src/core/render-svg.js';

const SVG_DIR = resolve(process.cwd(), 'assets/emojis/svg');
const PNG_DIR = resolve(process.cwd(), 'assets/emojis/png');

function decode(png: Buffer): Image { const i = new Image(); i.src = png; return i; }

describe('renderSvg', () => {
  it('renders an SVG buffer to a PNG of the requested size', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="20" fill="#f00"/></svg>');
    const img = decode(renderSvg(svg, 128));
    expect(img.width).toBe(128);
    expect(img.height).toBe(128);
  });
});

describe('emoji assets', () => {
  const svgs = readdirSync(SVG_DIR).filter((f) => f.endsWith('.svg'));
  it('at least the currency trio exists', () => {
    expect(svgs).toEqual(expect.arrayContaining(['dw_cash.svg', 'dw_food.svg', 'dw_shard.svg']));
  });
  it.each(svgs)('%s has a 128×128 PNG sibling with transparent corners', (f) => {
    const png = readFileSync(resolve(PNG_DIR, f.replace('.svg', '.png')));
    const img = decode(png);
    expect(img.width).toBe(128);
    expect(img.height).toBe(128);
    const canvas = createCanvas(128, 128);
    const c = canvas.getContext('2d');
    c.drawImage(img, 0, 0);
    expect(c.getImageData(0, 0, 1, 1).data[3]).toBe(0);       // top-left corner alpha
    expect(c.getImageData(127, 127, 1, 1).data[3]).toBe(0);   // bottom-right corner alpha
  });
});
