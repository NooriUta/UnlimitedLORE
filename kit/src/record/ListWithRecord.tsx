// Экран «список + запись» одним компонентом kit (SPRINT_UXR_S14_KIT5/K5-LIST-WITH-RECORD).
//
// Повод — владелица 16.11 через пилота: «паспорт открывается не так, как в LORE. Спишитесь, как
// взаимодействуют большие блоки на экране: должно быть одинаково и настраиваемо по желанию». До этого
// связку «список остаётся, запись — в доке справа, снизу или во весь экран» LORE собирал у себя
// (web-next ListScreen), а пилот заменял список записью целиком.
//
// Здесь — только РАСКЛАДКА больших блоков и её состояние в адресе. Что за список и чем рисовать
// запись — решает приложение (K-14): список приходит готовым узлом, запись — функцией.
//
// Правила, перенесённые из LORE как есть (каждое — след находки):
//   • открытая запись, место и вид чужой записи — в адресе (?open=&place=&okind=); место «справа» —
//     умолчание и в адрес не пишется;
//   • закрыли запись — из адреса уходят место, вид и вкладка записи (аудит 08.11, D-21): иначе
//     следующая запись откроется с чужой вкладки, а «закрыл» не совпадёт с «дал ссылку на список»;
//   • открыть и закрыть — шаг истории, «назад» его отменяет; листание и смена места — заменой (D-24);
//   • «назад» и «вперёд» браузера двигают и экран (D-24);
//   • выход из «во весь экран» — в то место, откуда вошли (MP2-11);
//   • меню оболочки убирается на время чтения, если человек так выбрал, и возвращается при закрытии
//     (D-2026-UXR-READ-COLLAPSE): выбор человека kit не затирает.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { onUrlStateWrite, pushUrlState, readUrlState, urlStateHref, type UrlWindow } from '../resilience/urlState';
import { useOptionalKitShell } from '../shell/KitShell';
import { RecordDock, isRecordPlacement, type RecordPlacement } from './RecordDock';

export interface OpenRecord {
  /** Код открытой записи; null — запись не открыта. */
  id: string | null;
  place: RecordPlacement;
  /** Вид записи, если он чужой экрану (запись другого раздела по ссылке). */
  kind?: string | null;
}

export interface RecordOpenState {
  open: OpenRecord;
  setOpen: (next: OpenRecord) => void;
  /** Адрес списка без открытой записи — им крошка «←» становится ссылкой. */
  backHref?: string;
  /** Окно, в адресе которого живёт состояние (запись пишет туда свою вкладку). */
  win?: UrlWindow;
}

/**
 * Открытая запись и место — в адресе окна. `win` нет — состояние в памяти (тесты, вложенный экран).
 * `defaultPlace` — место, когда в адресе его нет: личная настройка человека, иначе справа.
 */
export function useRecordOpen({ win, defaultPlace }: { win?: UrlWindow; defaultPlace: () => RecordPlacement }): RecordOpenState {
  const fromUrl = (w: UrlWindow): OpenRecord => {
    const p = readUrlState(w);
    const raw = p.get('place') ?? '';
    return { id: p.get('open') || null, place: isRecordPlacement(raw) ? raw : defaultPlace(), kind: p.get('okind') || null };
  };
  const [open, setOpenState] = useState<OpenRecord>(() => (win ? fromUrl(win) : { id: null, place: defaultPlace() }));
  // «Назад» и «вперёд» меняют адрес не нашими руками — экран идёт за ним. У подменного окна тестов
  // событий нет — там и не следим.
  useEffect(() => {
    const w = win as (UrlWindow & Partial<Pick<Window, 'addEventListener' | 'removeEventListener'>>) | undefined;
    if (!w?.addEventListener || !w.removeEventListener) return;
    const sync = () => setOpenState(fromUrl(w));
    // Запись адреса через kit (меню оболочки, setUrlParams) — тоже: pushState событий не шлёт.
    const off = onUrlStateWrite(sync);
    w.addEventListener('popstate', sync);
    w.addEventListener('hashchange', sync);
    return () => { off(); w.removeEventListener!('popstate', sync); w.removeEventListener!('hashchange', sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win]);
  const setOpen = (next: OpenRecord) => {
    setOpenState(next);
    if (!win) return;
    const closed = next.id == null;
    const patch = {
      open: next.id,
      okind: closed ? null : next.kind ?? null,
      place: closed || next.place === 'right' ? null : next.place,
      ...(closed ? { tab: null } : {}),
    };
    const step = (open.id == null) !== closed;
    pushUrlState(patch, { replace: !step, win, ...(closed ? { anchor: null } : {}) });
  };
  const backHref = win ? urlStateHref(win, { open: null, okind: null, place: null, tab: null }, { anchor: null }) : undefined;
  return { open, setOpen, backHref, win };
}

/** Чем запись управляет раскладкой — передаётся в функцию отрисовки записи. */
export interface RecordSlot {
  id: string;
  kind?: string | null;
  place: RecordPlacement;
  /** Место, куда вернёт выход из «во весь экран». */
  backPlace: RecordPlacement;
  setPlace: (p: RecordPlacement) => void;
  /** Открыть другую запись в том же месте (листалка). */
  go: (id: string) => void;
  close: () => void;
  /** Развернуть во весь экран; уже развёрнута — нет. */
  full?: () => void;
}

export interface ListWithRecordProps {
  /** Список раздела — остаётся под записью (фон дока). */
  list: ReactNode;
  open: OpenRecord;
  onOpen: (next: OpenRecord) => void;
  /** Запись в доке. */
  record: (slot: RecordSlot) => ReactNode;
  /** Список готов — пока нет, док не открываем (нечего листать и не к чему вернуться). */
  ready?: boolean;
  /** Модален ли «во весь экран»: внутри оболочки шапка и меню остаются рабочими — тогда нет. */
  modal?: boolean;
  /** Кто рисует «⤢/×»: строка записи приложения (`bar`) или сам док (`dock`). */
  controls?: 'dock' | 'bar';
  /** Сворачивать меню оболочки на время чтения (личная настройка человека). */
  collapseNavOnRead?: boolean;
  /** Место по умолчанию — куда вернуться из «во весь экран», если вошли сразу в него. */
  defaultPlace?: RecordPlacement;
}

export function ListWithRecord({ list, open, onOpen, record, ready = true, modal, controls = 'bar', collapseNavOnRead = false, defaultPlace = 'right' }: ListWithRecordProps) {
  const shell = useOptionalKitShell();
  const lastDock = useRef<RecordPlacement>(open.place !== 'full' ? open.place : defaultPlace);
  if (open.place !== 'full') lastDock.current = open.place;
  const setCollapsed = shell?.setMenuCollapsed;
  useEffect(() => {
    if (!collapseNavOnRead || !setCollapsed) return;
    setCollapsed(!!open.id);
    return () => setCollapsed(false);
  }, [collapseNavOnRead, setCollapsed, open.id]);
  if (!open.id || !ready) return <>{list}</>;
  const id = open.id;
  const backPlace = lastDock.current;
  const slot: RecordSlot = {
    id, kind: open.kind, place: open.place, backPlace,
    setPlace: p => onOpen({ ...open, place: p }),
    go: next => onOpen({ ...open, id: next }),
    close: () => onOpen({ ...open, id: null }),
    ...(open.place === 'full' ? {} : { full: () => onOpen({ ...open, place: 'full' }) }),
  };
  return (
    <RecordDock placement={open.place} modal={modal ?? shell == null} controls={controls} backdrop={list}
      onExitFull={() => onOpen({ ...open, place: backPlace })} onClose={slot.close}>
      {record(slot)}
    </RecordDock>
  );
}
