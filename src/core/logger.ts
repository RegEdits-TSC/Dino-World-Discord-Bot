import { pino } from 'pino';

// Silent under Vitest so intentional error-path tests keep pristine output; 'info' in production.
export const logger = pino({ level: process.env.LOG_LEVEL ?? (process.env.VITEST ? 'silent' : 'info') });
