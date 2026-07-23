import { createCanvas, GlobalFonts, Image, type SKRSContext2D } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { ParkSnapshot, SnapshotLot } from '../../modules/park/snapshot.js';
import { lotIcon, tilePalette, dinoGlyph, RARITY_COLOR } from '../../data/render-icons.js';

const COLS = 3;
const TILE_W = 270, TILE_H = 150, GAP = 16, PAD = 20, HEADER_H = 64;
const SANS = 'Noto Sans', EMOJI = 'Noto Color Emoji';

export interface GridDims { cols: number; rows: number; width: number; height: number }

// Pure geometry: how big the canvas is for N cells (lots + optional build slot) at 3 columns.
export function gridDims(cellCount: number): GridDims {
  const cells = Math.max(cellCount, 1);
  const rows = Math.ceil(cells / COLS);
  const width = PAD * 2 + COLS * TILE_W + (COLS - 1) * GAP;
  const height = HEADER_H + PAD * 2 + rows * TILE_H + (rows - 1) * GAP;
  return { cols: COLS, rows, width, height };
}

let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  const okSans = GlobalFonts.registerFromPath(resolve(process.cwd(), 'assets/fonts/NotoSans-Regular.ttf'), SANS);
  const okEmoji = GlobalFonts.registerFromPath(resolve(process.cwd(), 'assets/fonts/NotoColorEmoji.ttf'), EMOJI);
  if (!okSans || !okEmoji) throw new Error('park renderer: font registration failed');
  fontsReady = true;
}

// SVG source, not a PNG: renderParkPng is synchronous and raster decode is not.
let hudCash: Image | null | undefined;
function hudCashIcon(): Image | null {
  if (hudCash !== undefined) return hudCash;
  try {
    const img = new Image();
    img.src = readFileSync(resolve(process.cwd(), 'assets/emojis/svg/dw_cash.svg'));
    hudCash = img;
  } catch { hudCash = null; }
  return hudCash;
}

function rrect(c: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath(); c.roundRect(x, y, w, h, r);
}

// Truncate a string with an ellipsis to fit maxW under the CURRENT font.
function trunc(c: SKRSContext2D, s: string, maxW: number): string {
  if (c.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && c.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

// Draw an emoji (emoji font) then a value (sans) on one baseline; return the x after the value.
function iconValue(c: SKRSContext2D, x: number, y: number, emoji: string, value: string, size: number): number {
  c.font = `${size}px "${EMOJI}"`; c.fillText(emoji, x, y);
  const ew = c.measureText(emoji).width;
  c.font = `${size}px "${SANS}"`; c.fillText(value, x + ew + 6, y);
  return x + ew + 6 + c.measureText(value).width;
}

// Like iconValue, but with a drawn icon instead of an emoji glyph.
function iconImageValue(c: SKRSContext2D, x: number, y: number, img: Image, value: string, size: number): number {
  c.drawImage(img, x, y - size + 3, size, size);
  c.font = `${size}px "${SANS}"`; c.fillText(value, x + size + 6, y);
  return x + size + 6 + c.measureText(value).width;
}

// Pure text composition for the dino-count HUD stat. iconValue draws its `value` argument entirely
// in SANS, which has no emoji coverage — so this must never embed an emoji (that previously drew as
// a missing-glyph "tofu" box when an alert emoji was packed into this same string). Plain words carry
// the escaped-count information instead, staying inside one font for the whole run.
export function dinoStatText(dinoCount: number, escapedCount: number): string {
  return escapedCount > 0 ? `${dinoCount} (${escapedCount} escaped)` : String(dinoCount);
}

function drawTile(c: SKRSContext2D, lot: SnapshotLot, x: number, y: number): void {
  const pal = tilePalette(lot.type);
  rrect(c, x, y, TILE_W, TILE_H, 12); c.fillStyle = pal.fill; c.fill();
  c.lineWidth = 3; c.strokeStyle = pal.border; rrect(c, x, y, TILE_W, TILE_H, 12); c.stroke();

  c.font = `30px "${EMOJI}"`; c.fillText(lotIcon(lot.type, lot.kind), x + 14, y + 42);
  c.fillStyle = pal.text;
  c.font = `18px "${SANS}"`; c.fillText(trunc(c, lot.name, TILE_W - 72), x + 54, y + 34);
  c.font = `13px "${SANS}"`; c.fillText(`Lv ${lot.level}`, x + 54, y + 54);

  let dx = x + 16; const dy = y + 100;
  for (const d of lot.dinos.slice(0, 6)) {
    c.font = `28px "${EMOJI}"`; c.fillText(dinoGlyph(d.rarity), dx, dy);
    c.fillStyle = RARITY_COLOR[d.rarity];
    c.beginPath(); c.arc(dx + 14, dy + 10, 4, 0, Math.PI * 2); c.fill();
    dx += 34;
  }
  if (lot.dinos.length > 6) {
    c.font = `14px "${SANS}"`; c.fillStyle = pal.text; c.fillText(`+${lot.dinos.length - 6}`, dx, dy);
  }
  if (lot.dinos.some((d) => d.escaped)) {
    c.font = `20px "${EMOJI}"`; c.fillText('🚨', x + TILE_W - 34, y + 34);
  }
  for (let k = 0; k < Math.min(lot.decorCount, 5); k++) {
    c.fillStyle = '#2f6b2a'; c.beginPath(); c.arc(x + 18 + k * 12, y + TILE_H - 14, 4, 0, Math.PI * 2); c.fill();
  }
}

function drawBuildSlot(c: SKRSContext2D, x: number, y: number): void {
  c.setLineDash([8, 6]); c.lineWidth = 2; c.strokeStyle = '#9fb8a0';
  rrect(c, x, y, TILE_W, TILE_H, 12); c.stroke(); c.setLineDash([]);
  c.font = `16px "${SANS}"`; c.fillStyle = '#d6ead6'; c.textAlign = 'center';
  c.fillText('+  /build', x + TILE_W / 2, y + TILE_H / 2 + 5); c.textAlign = 'left';
}

export function renderParkPng(snap: ParkSnapshot): Buffer {
  ensureFonts();
  const hasBuild = snap.lots.length < snap.lotCap;
  const cellCount = snap.lots.length + (hasBuild ? 1 : 0);
  const dims = gridDims(cellCount);
  const canvas = createCanvas(dims.width, dims.height);
  const c = canvas.getContext('2d');

  c.fillStyle = '#356b2c'; c.fillRect(0, 0, dims.width, dims.height);          // grass
  c.fillStyle = '#234a1e'; c.fillRect(0, 0, dims.width, HEADER_H);             // header bar

  c.fillStyle = '#ffffff';
  c.font = `24px "${SANS}"`; c.fillText(trunc(c, snap.parkName, dims.width * 0.42), PAD, 40);
  let sx = dims.width * 0.46;
  sx = iconValue(c, sx, 40, '⭐', (snap.parkRating / 100).toFixed(1), 22) + 18;
  const cashIcon = hudCashIcon();
  sx = (cashIcon
    ? iconImageValue(c, sx, 40, cashIcon, snap.cash.toLocaleString(), 22)
    : iconValue(c, sx, 40, '💰', snap.cash.toLocaleString(), 22)) + 18;
  iconValue(c, sx, 40, '🦕', dinoStatText(snap.dinoCount, snap.escapedCount), 22);

  for (let idx = 0; idx < snap.lots.length; idx++) {
    const col = idx % COLS, row = Math.floor(idx / COLS);
    drawTile(c, snap.lots[idx], PAD + col * (TILE_W + GAP), HEADER_H + PAD + row * (TILE_H + GAP));
  }
  if (hasBuild) {
    const idx = snap.lots.length, col = idx % COLS, row = Math.floor(idx / COLS);
    drawBuildSlot(c, PAD + col * (TILE_W + GAP), HEADER_H + PAD + row * (TILE_H + GAP));
  }
  return canvas.toBuffer('image/png');
}
