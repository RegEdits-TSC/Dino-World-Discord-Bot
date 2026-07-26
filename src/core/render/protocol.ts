import { renderParkPng } from './draw.js';
import type { ParkSnapshot } from '../../modules/park/snapshot.js';

// The single definition of the client↔worker message shape. Both sides import
// it, so a field rename is a compile error instead of a silent live-render loss.
export interface RenderRequest { id: number; snapshot: ParkSnapshot }
export interface WorkerReply { id: number; ok: boolean; png?: Buffer; error?: string }

export function handleRenderRequest(
  req: RenderRequest, render: (s: ParkSnapshot) => Buffer = renderParkPng,
): WorkerReply {
  try {
    return { id: req.id, ok: true, png: render(req.snapshot) };
  } catch (e) {
    return { id: req.id, ok: false, error: String(e) };
  }
}
