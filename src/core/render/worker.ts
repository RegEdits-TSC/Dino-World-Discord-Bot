import { parentPort } from 'node:worker_threads';
import { handleRenderRequest, type RenderRequest } from './protocol.js';

// One message in, one message out. The id lets the client ignore replies for a
// request it already abandoned (e.g. after a timeout), so a stale reply can never
// resolve a newer request on the reused worker.
parentPort?.on('message', (req: RenderRequest) => {
  parentPort!.postMessage(handleRenderRequest(req));
});
