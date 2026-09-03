// `multistream` and `destination` are named exports, NOT properties of the `pino` function:
// in pino's types they live inside `declare namespace pino`, so `pino.multistream(...)` fails
// to typecheck (TS2339) even though it resolves at runtime.
import { pino, multistream, destination } from 'pino';

// Silent under Vitest so intentional error-path tests keep pristine output; 'info' in production.
const level = process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info');

/**
 * Logs to the console AND to `logs/bot.log`, so a failure survives the terminal it happened
 * in. On 2026-09-03 the bot stopped and left no record anywhere of why; this file is half
 * the answer, and the crash handlers in src/index.ts are the other half — without those,
 * an uncaught error terminates the process before the logger ever sees it, and a log file
 * on its own would have captured nothing.
 *
 * multistream with `sync: true` rather than pino.transport, and the reason is narrower than
 * it might look. Both were tried against a deliberate uncaught throw and BOTH captured the
 * fatal line — a worker transport did not lose it, so do not repeat that as the reason. What
 * sync buys is the removal of the dependency: the transport's write survives only because the
 * worker flushes while the process is tearing down, which pino treats as best effort and
 * which no test here would notice breaking. A synchronous destination has already written
 * before `process.exit(1)` is reached. The cost is throughput this bot does not need.
 *
 * Under Vitest there is no second stream at all: `level` is already 'silent', so a file
 * destination would open a real handle per test file to write nothing to it.
 */
export const logger = process.env.VITEST
  ? pino({ level })
  : pino({ level }, multistream([
    { stream: process.stdout },
    { stream: destination({ dest: 'logs/bot.log', sync: true, mkdir: true }) },
  ]));
