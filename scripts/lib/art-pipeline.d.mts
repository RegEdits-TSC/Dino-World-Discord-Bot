// Hand-written declarations for art-pipeline.mjs. tsconfig has allowJs off, so a
// TypeScript test cannot import the .mjs without these. Update both together.
// Must be named .d.mts, not .d.ts: under this repo's "module"/"moduleResolution":
// "NodeNext" (tsconfig.json), an import specifier ending in .mjs resolves its
// declaration from a sibling .d.mts file only — a .d.ts file of the same name is
// silently ignored and the import falls back to implicit any (TS7016).
export declare const Q: number;
export declare const COVER: Record<'banner' | 'ground' | 'band', [number, number]>;
export declare function coverGeometry(
  srcW: number, srcH: number, W: number, H: number,
): { w: number; h: number; dx: number; dy: number };
export declare function alphaThreshold(px: Uint8ClampedArray, cutoff?: number): void;
export declare function luminancePeel(
  px: Uint8ClampedArray, w: number, h: number, passes?: number,
): void;
export declare function opaqueBBox(
  px: Uint8ClampedArray, w: number, h: number,
): { x0: number; y0: number; x1: number; y1: number } | null;
export declare function stripCaBX(buf: Buffer): Buffer;
export declare const FIT_31: number;
export declare const FIT_24: number;
export interface BBox { x0: number; y0: number; x1: number; y1: number }
export declare function largestRegion(px: Uint8ClampedArray, w: number, h: number): void;
export declare function borderFlood(px: Uint8ClampedArray, w: number, h: number): void;
export declare function shave(px: Uint8ClampedArray, w: number, h: number, n?: number): void;
export declare function eggAxisBBox(
  px: Uint8ClampedArray, w: number, h: number, box: BBox,
): BBox;
export declare function fitDraw(
  box: BBox, fitBox: BBox, FIT: number, S: number,
): { scale: number; cx: number; cy: number };
