import { parentPort } from 'node:worker_threads';
import { renderParkPng } from './draw.js';
import type { ParkSnapshot } from '../../modules/park/snapshot.js';

// One message in, one message out. The buffer is structured-cloned back (no transfer,
// to avoid detaching a pooled Buffer's backing store).
parentPort?.on('message', (snapshot: ParkSnapshot) => {
  try {
    const png = renderParkPng(snapshot);
    parentPort!.postMessage({ ok: true, png });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: String(e) });
  }
});
