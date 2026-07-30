import { parentPort } from 'node:worker_threads';
import { handleRenderRequest, type RenderRequest } from './protocol.js';
import { renderParkPng } from './draw.js';
import { EMPTY_ART, loadParkArt } from './art.js';

// Preloaded once, before the first message is handled. Two rules are load-bearing here:
// 1. This must never reject. A rejected top-level await surfaces as the worker's 'error' event, and
//    client.ts terminates + nulls the worker on that — so every later render respawns a worker that
//    dies the same way and /park view silently degrades to a text-only embed forever. loadParkArt
//    already catches per asset; the .catch here is belt and braces.
// 2. Art stays worker-side. It never rides on a RenderRequest — a canvas Image is not
//    structured-cloneable, and decoding it once per render would defeat the preload anyway.
// Messages posted before this resolves are buffered by the MessagePort and delivered once the
// listener attaches, so the await costs the first render latency, never a lost request.
const art = await loadParkArt().catch(() => EMPTY_ART);

// One message in, one message out. The id lets the client ignore replies for a
// request it already abandoned (e.g. after a timeout), so a stale reply can never
// resolve a newer request on the reused worker.
parentPort?.on('message', (req: RenderRequest) => {
  parentPort!.postMessage(handleRenderRequest(req, (snap) => renderParkPng(snap, art)));
});
