// Экран списка v2 — спринты / ADR (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04).
// Данные — реальный слайс LORE через клиент v2 (api/loreClient), состояния —
// хук kit (useLoadState): loading → скелет, 403 → «нет прав», сбой → ошибка с
// причиной и «Повторить». Пустоту и «обрезано» рисует сам движок списка kit
// по meta (проверенный ноль ≠ «фильтр отсеял» ≠ «обрезано сервером»).
import { useMemo } from 'react';
import { Forbidden, ListView, LoadError, ScreenHead, Skeleton, useKitLang, useLoadState } from '@seidr/kit';
import type { UrlWindow } from '@seidr/kit';
import { fetchSlice } from '../api/loreClient';
import { useAppT } from '../i18n';
import { LIST_SCREENS, type ListScreenId } from '../lists/screens';
import { sliceToKitData, sliceWarnings } from '../lists/records';
import './ListScreen.css';

export interface ListScreenProps {
  screen: ListScreenId;
  /** Подмена сети (тесты); по умолчанию — window.fetch. */
  fetchImpl?: typeof fetch;
  /** Состояние списка в URL (по умолчанию window); false — в памяти. */
  urlState?: boolean | UrlWindow;
  /** Свой заголовок экрана; false — внутри раздела оболочки, где заголовок уже есть. */
  heading?: boolean;
  /**
   * id заголовка (S4-23): раздел оболочки подписан им через aria-labelledby.
   * Заголовок — шапка экрана kit (ScreenHead): виды встают в его строку.
   */
  titleId?: string;
}

export function ListScreen({ screen, fetchImpl, urlState, heading = true, titleId }: ListScreenProps) {
  const def = LIST_SCREENS[screen];
  const lang = useKitLang();
  const t = useAppT();
  const config = useMemo(() => def.config(lang), [def, lang]);
  const result = useLoadState(
    signal => fetchSlice(def.slice, undefined, { signal, fetchImpl }),
    [def.slice, fetchImpl],
    { rows: body => body.rows },
  );
  const body = result.data;
  const data = useMemo(
    () => (body ? sliceToKitData(body, def.map, new Date().toISOString()) : null),
    [body, def],
  );
  const warnings = body ? sliceWarnings(body) : [];

  const headId = titleId ?? `list-screen-${screen}`;
  // Иконка заголовка — из канона LORE v1 (S4-25): def.icon = иконка раздела v1.
  const head = heading ? { title: t(def.titleKey), titleId: headId, icon: def.icon } : undefined;
  const ready = !(result.state === 'loading' || result.state === 'error' || result.state === 'forbidden' || !data);

  let content;
  if (result.state === 'loading' || (!data && result.state !== 'error' && result.state !== 'forbidden')) {
    content = <Skeleton lines={6} label={t('lists.loading')} />;
  } else if (result.state === 'forbidden') {
    content = <Forbidden reason={body?.outside_scope?.reason ?? (result.error instanceof Error ? result.error.message : undefined)} />;
  } else if (result.state === 'error' || !data) {
    content = <LoadError error={result.error} onRetry={result.reload} />;
  } else {
    content = (
      <ListView
        config={config}
        data={data}
        urlState={urlState}
        quickIcons={def.quickIcons}
        head={head}
      />
    );
  }

  return (
    <section className="list-screen" data-screen={screen} aria-labelledby={heading && !titleId ? headId : undefined}>
      {/* Пока списка нет (загрузка, ошибка, нет прав) — та же шапка без видов: заголовок не прыгает. */}
      {head && !ready && <ScreenHead {...head} />}
      {warnings.length > 0 && (
        <ul className="list-screen__warn" aria-label={t('lists.warnings')}>
          {warnings.map(w => <li key={w}>{w}</li>)}
        </ul>
      )}
      {content}
    </section>
  );
}

export default ListScreen;
