import { createCanvas, Image } from '@napi-rs/canvas';

// SVG → transparent PNG at size×size. @napi-rs/canvas decodes SVG buffers
// synchronously via its bundled resvg.
export function renderSvg(svg: Buffer, size: number): Buffer {
  const img = new Image();
  img.src = svg;
  const canvas = createCanvas(size, size);
  const c = canvas.getContext('2d');
  c.drawImage(img, 0, 0, size, size);
  return canvas.toBuffer('image/png');
}
