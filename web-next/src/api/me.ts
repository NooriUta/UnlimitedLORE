// Личное пользователя v2 — /lore/me/* по контракту S2 (SPEC-LORE-UXR-S2-CONTRACTS,
// web-next/src/api/contracts/s2.ts). SPRINT_UXR_S4_UI_SHELL_LISTS/S4-02.
//
// Бэкенд S2-04/S2-05 ещё не готов, поэтому клиент — заглушка той же
// поверхности S2Client. Отличие от чистой s2.stubs: настройки
// (/lore/me/settings) переживают перезагрузку — лежат в хранилище браузера v2
// (lore.v2.me.settings, с откатом в память и плашкой S4-00f) с теми же
// правилами, что у сервера: проверка ключей (400), expected_version (409 с
// current), незнакомые ключи ответа отбрасываются. Память и прочее — из
// заглушки контракта, в памяти вкладки.
//
// S2-04 выкатился, и приложение ходит на сервер: App.tsx использует
// createLiveS2Client (api/liveS2.ts, SPRINT_UXR_S5_RECORD_TASKS/S5-14).
// Этот клиент остался ТЕСТОВЫМ ДУБЛЁРОМ: на нём держатся проверки экрана
// настроек (settings/avatarSettings.test.tsx), где не нужна сеть. В приложении
// он не подключён — и подключать его как «откат, если сервер не ответил»
// нельзя: локальная копия выглядела бы сохранённой, а на другом устройстве её
// бы не было.
import type { SafeStorage } from '@seidr/kit';
import {
  DEFAULT_SETTINGS, mergeSettings, validateSettingsPatch,
  type S2Caller, type SettingsResponse, type UserSettings,
} from './contracts/s2';
import { S2ConflictError, S2HttpError, createS2Stub, type S2Client } from './contracts/s2.stubs';
import { v2Key } from '../storage/storage';

export const SETTINGS_KEY = v2Key('me.settings');

interface StoredSettings {
  settings: Partial<UserSettings>;
  version: number;
  updated_at?: string | null;
  /** Схема снимка; нет — снимок до S4-21. */
  schema?: number;
}

/**
 * Схема 2 (S4-21): плотность по умолчанию стала roomy. Снимок хранит ВСЕ
 * настройки, поэтому 'compact' в снимке схемы 1 — прежнее умолчание, а не
 * выбор человека: читаем его как roomy. После первой записи стоит метка 2,
 * и явный compact дальше уважается. comfortable был только выбором — не трогаем.
 */
const SETTINGS_SCHEMA_VERSION = 2;
function migrate(settings: Partial<UserSettings>, schema: number | undefined): Partial<UserSettings> {
  if ((schema ?? 1) < 2 && settings.density === 'compact') return { ...settings, density: 'roomy' };
  return settings;
}

export interface LocalS2Options {
  /**
   * Начальные настройки, пока пользователь ничего не сохранял: тема из v1 и
   * cookie seer-prefs, чтобы v2 не открылся в чужой теме. Сохранённое главнее.
   */
  seed?: Partial<UserSettings>;
  caller?: S2Caller;
  /** Часы — для updated_at (тесты). */
  now?: () => string;
}

function readStored(storage: SafeStorage): StoredSettings | null {
  const raw = storage.get(SETTINGS_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<StoredSettings> | null;
    if (!v || typeof v !== 'object' || typeof v.version !== 'number' || v.version < 1) return null;
    const settings = v.settings && typeof v.settings === 'object' ? v.settings : {};
    return { settings: migrate(settings, v.schema), version: v.version, updated_at: v.updated_at ?? null, schema: SETTINGS_SCHEMA_VERSION };
  } catch {
    return null;
  }
}

export function createLocalS2Client(storage: SafeStorage, opts: LocalS2Options = {}): S2Client {
  const base = createS2Stub({ caller: opts.caller });
  const now = opts.now ?? (() => new Date().toISOString());
  const caller = opts.caller ?? { kind: 'human', kc_sub: 'sub-owner', roles: [] };

  const current = (): SettingsResponse => {
    const stored = readStored(storage);
    return {
      settings: mergeSettings(stored ? stored.settings : { ...DEFAULT_SETTINGS, ...opts.seed }),
      defaults: { ...DEFAULT_SETTINGS },
      version: stored?.version ?? 1,
      updated_at: stored?.updated_at ?? null,
    };
  };

  const requireSub = () => {
    if (caller.kind === 'anonymous') throw new S2HttpError(401, { error: 'UNAUTHENTICATED', detail: 'личные эндпоинты требуют токен' });
  };

  return {
    ...base,
    async getSettings() {
      requireSub();
      return current();
    },
    async patchSettings(req) {
      requireSub();
      if (caller.kind === 'agent') throw new S2HttpError(403, { error: 'AGENT_SCOPE_FORBIDDEN', detail: 'личные настройки правит человек' });
      const bad = validateSettingsPatch(req.patch);
      if (bad.length) throw new S2HttpError(400, { error: 'BAD_PARAMS', detail: `недопустимые ключи: ${bad.join(', ')}` });
      const cur = current();
      if (req.expected_version !== cur.version) throw new S2ConflictError<SettingsResponse>(cur);
      const next: StoredSettings = { settings: { ...cur.settings, ...req.patch }, version: cur.version + 1, updated_at: now(), schema: SETTINGS_SCHEMA_VERSION };
      storage.set(SETTINGS_KEY, JSON.stringify(next));
      return current();
    },
  };
}
