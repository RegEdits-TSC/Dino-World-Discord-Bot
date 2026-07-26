import { Worker } from 'node:worker_threads';
import type { ParkSnapshot } from '../../modules/park/snapshot.js';
import type { WorkerReply } from './protocol.js';

export const RENDER_TIMEOUT_MS = 3000;

type Runner = (snapshot: ParkSnapshot) => Promise<Buffer>;

// Reject if `p` doesn't settle within `ms`.
export function raceTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error('render timeout')), ms);
    p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
  });
}

let worker: Worker | null = null;
let seq = 0;

// dist: ./worker.js beside this file. dev (tsx): ./worker.ts (may fail to load → graceful fallback).
function workerUrl(): URL {
  return new URL(import.meta.url.endsWith('.ts') ? './worker.ts' : './worker.js', import.meta.url);
}

function getWorker(): Worker {
  if (!worker) {
    const w = new Worker(workerUrl());
    w.on('error', () => { w.terminate(); if (worker === w) worker = null; });
    w.on('exit', () => { if (worker === w) worker = null; });
    worker = w;
  }
  return worker;
}

export interface WorkerLike {
  on(ev: string, fn: (...a: any[]) => void): unknown;
  off(ev: string, fn: (...a: any[]) => void): unknown;
  postMessage(m: unknown): void;
}

export function createRunner(getW: () => WorkerLike): Runner {
  return (snapshot) => new Promise<Buffer>((res, rej) => {
    let w: WorkerLike;
    try { w = getW(); } catch (e) { rej(e instanceof Error ? e : new Error(String(e))); return; }
    const id = ++seq;
    const onMsg = (m: WorkerReply) => {
      if (m.id !== id) return;   // reply for an older, abandoned request — ignore
      cleanup();
      m.ok && m.png ? res(Buffer.from(m.png)) : rej(new Error(m.error ?? 'render failed'));
    };
    const onErr = (e: unknown) => { cleanup(); rej(e instanceof Error ? e : new Error(String(e))); };
    function cleanup() { w.off('message', onMsg as never); w.off('error', onErr as never); }
    w.on('message', onMsg as never); w.on('error', onErr as never);
    w.postMessage({ id, snapshot });
  });
}

const runOnWorker: Runner = createRunner(getWorker);

// Serialize renders through the single worker; each guarded by a timeout.
// `run` is injectable for testing; production uses the real worker runner.
let chain: Promise<unknown> = Promise.resolve();
export function renderPark(snapshot: ParkSnapshot, run: Runner = runOnWorker, timeoutMs = RENDER_TIMEOUT_MS): Promise<Buffer> {
  const result = chain.then(() => raceTimeout(run(snapshot), timeoutMs));
  chain = result.catch(() => undefined);   // keep the queue alive after a failure
  return result;
}
