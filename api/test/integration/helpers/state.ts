import { readFileSync } from 'node:fs';
import { STATE_FILE } from './paths.js';

export interface DatabaseState {
  /** Connection string for the table owner (runs migrations). */
  ownerUrl: string;
  /** Connection string for the restricted runtime role (`ldms_app`). */
  appUrl: string;
  /** Name of the throwaway database created for the test run. */
  database: string;
  /** Docker container id, so globalTeardown can stop it. */
  containerId: string;
}

export function readDatabaseState(): DatabaseState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as DatabaseState;
}
