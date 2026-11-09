// Личные настройки v2: чтение и запись через S2Client (S4-02).
// Применение — сразу (оптимистично), сохранение — PATCH с expected_version:
//   409 (другая вкладка/устройство успели записать) — берём current из ответа
//       и повторяем ту же правку поверх него один раз;
//   любая другая ошибка — откат значения и честная плашка «не сохранилось».
// Не прочитали настройки — состояние error, умолчания за сохранённое не выдаём.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SettingsResponse, UserSettings } from '../api/contracts/s2';
import { S2ConflictError, type S2Client } from '../api/contracts/s2.stubs';

export type SettingsState =
  | { status: 'loading' }
  | { status: 'error'; error: unknown }
  | {
      status: 'ok'; settings: UserSettings; version: number; saving: boolean; saveError?: unknown;
      /**
       * Расхождения перевода с сервера (S5-14): сервер хранит значение,
       * которого в v2 нет. Показываем умолчание и говорим об этом — молча
       * подменить значение значит соврать о том, что выбрано.
       */
      warnings?: string[];
    };

export interface UseSettings {
  state: SettingsState;
  set: (patch: Partial<UserSettings>) => Promise<void>;
  reload: () => void;
}

export function useSettings(client: S2Client, apply: (s: UserSettings) => void): UseSettings {
  const [state, setState] = useState<SettingsState>({ status: 'loading' });
  const ref = useRef(state);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const put = (s: SettingsState) => { ref.current = s; setState(s); };

  const reload = useCallback(() => {
    let live = true;
    put({ status: 'loading' });
    client.getSettings().then(
      r => { if (!live) return; applyRef.current(r.settings); put({ status: 'ok', settings: r.settings, version: r.version, saving: false, warnings: r.warnings }); },
      error => { if (live) put({ status: 'error', error }); },
    );
    return () => { live = false; };
  }, [client]);

  useEffect(() => reload(), [reload]);

  const set = useCallback(async (patch: Partial<UserSettings>) => {
    const cur = ref.current;
    if (cur.status !== 'ok') return;
    const prev = cur.settings;
    const next = { ...prev, ...patch };
    applyRef.current(next);
    put({ ...cur, settings: next, saving: true, saveError: undefined });
    let saved: SettingsResponse;
    try {
      try {
        saved = await client.patchSettings({ patch, expected_version: cur.version });
      } catch (e) {
        const current = e instanceof S2ConflictError ? (e.body.current as SettingsResponse | undefined) : undefined;
        if (!current) throw e;
        saved = await client.patchSettings({ patch, expected_version: current.version });
      }
    } catch (saveError) {
      applyRef.current(prev);
      put({ status: 'ok', settings: prev, version: cur.version, saving: false, saveError });
      return;
    }
    applyRef.current(saved.settings);
    put({ status: 'ok', settings: saved.settings, version: saved.version, saving: false, warnings: saved.warnings });
  }, [client]);

  return { state, set, reload };
}
