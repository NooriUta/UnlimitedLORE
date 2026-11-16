// Карточка Peek с загрузкой (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 5: «peek и разбор
// ссылок — по конфигу приложения»). Перенесено из web-next (LorePeek): цикл «загрузка → карточка
// или честный отказ → Повторить» общий, а ЧТО грузить — функция приложения (граница K-14).
// Загрузчик бросил — это сбой со словами, а не вечная «загрузка».
import { useCallback, useEffect, useState } from 'react';
import { PeekCard, type PeekState } from './PeekCard';

export interface PeekLoaderProps {
  /** Код записи — для состояний без данных и для перезапроса при смене. */
  id: string;
  /** Загрузить карточку; отказ — состоянием (missing/forbidden/error) или исключением. */
  load: () => Promise<PeekState>;
  /** Полный адрес для «Копировать ссылку» (href приложения бывает относительным). */
  absoluteHref?: (href: string) => string;
  /** Что ещё, кроме id, требует перезагрузки (тип записи, язык). */
  deps?: readonly unknown[];
}

export function PeekLoader({ id, load, absoluteHref, deps = [] }: PeekLoaderProps) {
  const [st, setSt] = useState<PeekState>({ state: 'loading' });
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setSt({ state: 'loading' });
    load().then(
      s => { if (live) setSt(s); },
      e => { if (live) setSt({ state: 'error', reason: e instanceof Error ? e.message : String(e) }); },
    );
    return () => { live = false; };
    // load — новая функция на каждый рендер приложения; перезагрузка — по id, deps и «Повторить».
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, n, ...deps]);
  const retry = useCallback(() => setN(x => x + 1), []);
  return <PeekCard peek={st} id={id} onRetry={retry} absoluteHref={absoluteHref} />;
}
