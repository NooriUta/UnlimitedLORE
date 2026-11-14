// Куда смоук стенда пишет отчёт (E2E-STAND): web-next/e2e/.stand-report, в git не идёт.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { standPreflight, type Preflight } from '../../src/standSmoke/summary.ts';

export const REPORT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.stand-report');
export const BUILD_FILE = resolve(REPORT_DIR, 'build.json');

/** Что global-setup узнал о стенде до сценариев. */
export interface StandBuild {
  standUrl: string | null;
  /** Куда привёл адрес после редиректов. */
  finalUrl: string | null;
  httpStatus: number | null;
  bundle: string | null;
  /** Адрес (или его редирект) ведёт на прод — сценарии не запускаются. */
  refused: boolean;
  error: string | null;
}

export function readBuild(): StandBuild | null {
  try { return JSON.parse(readFileSync(BUILD_FILE, 'utf8')) as StandBuild; } catch { return null; }
}

export function preflightFromEnv(): Preflight {
  return standPreflight({
    standUrl: process.env.LORE_STAND_URL,
    storageState: process.env.LORE_STAND_STORAGE_STATE,
    exists: existsSync,
  });
}
