// Флаги и версия LORE в админке v2 (SPRINT_UXR_S7B_ADMIN/S7B-08).
//
// Сервер (LoreAdminFlags, PR #957): GET /lore/admin/flags — белый список
// булевых флагов lore.* (секретов там нет) с умолчанием и пометкой overridden,
// плюс версия сборки. Тег релиза сборка не знает — его отдаёт только
// GET /lore/version (release; null — выкатка не передала LORE_RELEASE_TAG).
// Флаг без булева значения — сбой ответа, а не «выключен»: выдуманное
// значение флага хуже честной ошибки.
import { getJson, type FetchOptions } from './actions';

export interface FlagRow {
  key: string;
  value: boolean;
  def: boolean;
  overridden: boolean;
  /** Смысл флага — словами сервера (он знает, что флаг делает). */
  meaning: string | null;
}

export interface BuildVersion {
  commit: string | null;
  built_at: string | null;
  schema_version: number | string | null;
}

export interface FlagsData {
  flags: FlagRow[];
  version: BuildVersion;
  overridden: number;
}

/** Тег релиза: есть · выкатка не передала · не смогли прочитать. */
export type ReleaseInfo = { state: 'ok'; tag: string } | { state: 'none' } | { state: 'error'; reason: string };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

function malformed(what: string): never {
  throw new Error(`malformed answer: ${what}`);
}

export function parseFlags(raw: unknown): FlagsData {
  const b = obj(raw);
  if (!Array.isArray(b.flags)) malformed('flags');
  const flags = b.flags.map(obj).map(f => {
    const key = str(f.key);
    if (key === null) malformed('flag key');
    if (typeof f.value !== 'boolean') malformed(`value of ${key}`);
    const def = typeof f.default === 'boolean' ? f.default : null;
    if (def === null) malformed(`default of ${key}`);
    return {
      key, value: f.value, def,
      overridden: typeof f.overridden === 'boolean' ? f.overridden : f.value !== def,
      meaning: str(f.meaning),
    };
  });
  const v = obj(b.version);
  const schema = typeof v.schema_version === 'number' || typeof v.schema_version === 'string' ? v.schema_version : null;
  return {
    flags,
    version: { commit: str(v.commit), built_at: str(v.built_at), schema_version: schema },
    overridden: flags.filter(f => f.overridden).length,
  };
}

export async function fetchFlags(opts: FetchOptions = {}): Promise<FlagsData> {
  return parseFlags(await getJson('/lore/admin/flags', opts));
}

/** Тег релиза из /lore/version. Не бросает: флаги видны и без него. */
export async function fetchRelease(opts: FetchOptions = {}): Promise<ReleaseInfo> {
  try {
    const tag = str(obj(await getJson('/lore/version', opts)).release);
    return tag ? { state: 'ok', tag } : { state: 'none' };
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    return { state: 'error', reason: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchFlagsAndRelease(opts: FetchOptions = {}): Promise<FlagsData & { release: ReleaseInfo }> {
  const [flags, release] = await Promise.all([fetchFlags(opts), fetchRelease(opts)]);
  return { ...flags, release };
}
