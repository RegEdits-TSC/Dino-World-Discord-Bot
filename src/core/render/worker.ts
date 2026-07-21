import { parentPort } from 'node:worker_threads';
import { renderParkPng } from './draw.js';
import type { ParkSnapshot } from '../../modules/park/snapshot.js';

interface RenderRequest { id: number; snapshot: ParkSnapshot }

// One message in, one message out. The id lets the client ignore replies for a
// request it already abandoned (e.g. after a timeout), so a stale reply can never
// resolve a newer request on the reused worker.
parentPort?.on('message', (req: RenderRequest) => {
  try {
    const png = renderParkPng(req.snapshot);
    parentPort!.postMessage({ id: req.id, ok: true, png });
  } catch (e) {
    parentPort!.postMessage({ id: req.id, ok: false, error: String(e) });
  }
});
