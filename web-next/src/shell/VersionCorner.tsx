// Метка версии в правом нижнем углу (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30).
//
// Просьба владелицы 09.11.2026: «в правое нижний угол запиши версию сервера и
// версию фронта или одну если они вместе». Что именно говорит метка и почему
// одна она бывает не всегда — в `version.ts`; здесь только показ.
//
// Нажатие копирует метку ВМЕСТЕ С ПРИЧИНАМИ: версию спрашивают, чтобы её
// кому-то переслать, и «сервер: не проверено» без причины в переписке
// бесполезно. Буфер может быть недоступен (нет https, запрет политики) — тогда
// это сказано, а не проглочено: иначе нажатие выглядит сработавшим, а в буфере
// старое.
import { useEffect, useState } from 'react';
import { useKitLang } from '@seidr/kit';
import { appT } from '../i18n';
import { FRONT_COMMIT, fetchServerVersion, versionLabel, type VersionState } from './version';

export interface VersionCornerProps {
  /** Подмена сети (тесты, витрина). */
  fetchImpl?: typeof fetch;
  /** Готовое состояние — для тестов и витрины, без сети. */
  state?: VersionState;
  /** Отметка фронта; по умолчанию — из сборки. */
  front?: string;
  /** Буфер обмена; по умолчанию — navigator.clipboard. */
  clipboard?: { writeText: (s: string) => Promise<void> };
}

export function VersionCorner({ fetchImpl, state: given, front = FRONT_COMMIT, clipboard }: VersionCornerProps) {
  const lang = useKitLang();
  const [state, setState] = useState<VersionState>(given ?? { kind: 'loading' });
  const [said, setSaid] = useState('');

  useEffect(() => {
    if (given) { setState(given); return; }
    const ac = new AbortController();
    let alive = true;
    void fetchServerVersion({ fetchImpl, signal: ac.signal }).then(r => { if (alive) setState(r); });
    return () => { alive = false; ac.abort(); };
  }, [given, fetchImpl]);

  const { text, note } = versionLabel(lang, state, front);
  // Пока не спросили — ничего: пустой угол честнее метки, которой мы ещё не
  // знаем, и честнее мигания умолчанием.
  if (!text) return null;

  const full = note ? `${text} (${note})` : text;
  const copy = async () => {
    const cb = clipboard ?? (typeof navigator === 'undefined' ? undefined : navigator.clipboard);
    if (!cb) { setSaid(appT(lang, 'version.copyFailed')); return; }
    try {
      await cb.writeText(full);
      setSaid(appT(lang, 'version.copied'));
    } catch {
      setSaid(appT(lang, 'version.copyFailed'));
    }
  };

  return (
    <div className="v2-version sk-shell__corner">
      <button
        type="button"
        className="v2-version__btn"
        title={`${appT(lang, 'version.action')}${note ? ` · ${note}` : ''}`}
        aria-label={`${appT(lang, 'version.action')}: ${full}`}
        onClick={() => void copy()}
      >
        {text}
      </button>
      {/* Итог нажатия — словами и для скринридера: «нажала и ничего не
          произошло» ничем не отличается от «скопировалось». */}
      <span className="v2-version__said" role="status" aria-live="polite">{said}</span>
    </div>
  );
}
