// Паспорт записи, открытый из живого списка v2 (просьба владелицы 08.11: «подключить паспорта
// как есть, дальше улучшим»). Тот же путь, что у демо /kit/passport (S4-33): слайсы →
// loadPassport → toLoreRecord (lore.record/1) → fromLoreRecord → RecordView.
// S4-CONTENT-V4 (прототип v4): над записью — строка RecordReader: крошки «← Раздел / ID»,
// листалка по списку и «⤢». Свой ушко «Свойства» RecordReader НЕ включаем (aside нет):
// свойства во весь экран — рейка и свёртка самого RecordView (сессия kit, #914).
// Свой чанк: MartProse и граф тянут MD-элементы, список за них не платит.
import { useMemo, useState } from 'react';
import {
  LoadError, RecordCrumbs, RecordPager, RecordReader, Skeleton, useKitLang, useLoadState,
  type KitCtx, type RecordPlacement,
} from '@seidr/kit';
import { MartProse, MdInlineEdit } from '@seidr/kit/content';
import { fetchSlice } from '../api/loreClient';
import { useAppT } from '../i18n';
import { type PassportType } from './passportAdapters';
import { fromLoreRecord } from './loreRecordContract';
import { loadRecordContract } from './recordSource';
import { savePassportField } from './passportSave';
import { saveRelation } from './relationSave';
import { createDraftsApi, draftSlot } from '../api/drafts';
import { HISTORY_PAGE, HISTORY_TRACKED, HistoryForbidden, NOT_TRACKED, fetchHistory } from './historySource';

const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const md = (s: string) => <MartProse text={s} />;

export interface ListPassportProps {
  type: PassportType;
  id: string;
  placement: RecordPlacement;
  fetchImpl?: typeof fetch;
  /** Подпись раздела списка для крошек «← Спринты». */
  backLabel?: string;
  /** Крошки «←» — вернуться к списку (закрыть паспорт). */
  onBack?: () => void;
  /**
   * Адрес списка без открытой записи: крошка становится ссылкой — её можно
   * открыть в новой вкладке и скопировать (находка P1 аудита 08.11: «крошка —
   * кнопка, не ссылка»). Нет адреса — остаётся кнопка, поддельную ссылку не
   * рисуем.
   */
  backHref?: string;
  /** id записей списка в порядке показа — для листалки. */
  ids?: readonly string[];
  /** Перейти к соседней записи листалкой. */
  onGo?: (id: string) => void;
  /** «⤢» — развернуть на весь экран; нет — кнопки нет (уже во весь экран). */
  onFull?: () => void;
}

export default function ListPassport({ type, id, placement, fetchImpl, backLabel, backHref, onBack, ids = [], onGo, onFull }: ListPassportProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [tab, setTab] = useState('overview');
  const slice = useMemo(() => <T,>(name: string, params?: Record<string, string>) => fetchSlice<T>(name, params, { fetchImpl }), [fetchImpl]);
  const drafts = useMemo(() => createDraftsApi(fetchImpl), [fetchImpl]);
  // Вкладка «История» (S5-11) была в kit, но в v2 её никто не подключал:
  // RecordView.history нигде не передавался. Тип вне таблицы SCD2 — это
  // «история не ведётся», и сервер мы о нём не спрашиваем.
  // Листание истории (S9-09): растим предел и перечитываем страницу. Растить,
  // а не склеивать куски: сервер отдаёт историю одной выборкой с page, и
  // склейка на клиенте разошлась бы с ней при чужой правке посреди листания.
  const [histLimit, setHistLimit] = useState(HISTORY_PAGE);
  const hist = useLoadState(
    () => (HISTORY_TRACKED.has(type)
      ? fetchHistory(type, id, { limit: histLimit }, fetchImpl)
      : Promise.resolve(NOT_TRACKED)),
    [type, id, fetchImpl, histLimit],
  );
  // Источник паспорта — боевой фасад /lore/record (S4-MODEL-PASSPORT-LIST).
  // Вместе с ним приходит `record.version` (без неё нет защиты от затирания,
  // S5-08), настоящие `perms` и состояние блоков. Фасад не ответил — паспорт
  // собирается из срезов, и причина НАЗВАНА строкой в состоянии данных:
  // молчаливый откат выглядел бы настоящим паспортом без версии.
  const pp = useLoadState(
    () => loadRecordContract(type, id, lang, slice, { fetchImpl }),
    [type, id, lang, slice, fetchImpl],
  );
  const contract = pp.data ?? null;
  const view = useMemo(() => (contract ? fromLoreRecord(contract, lang) : null), [contract, lang]);
  if (pp.state === 'error') return <LoadError error={pp.error} onRetry={pp.reload} />;
  if (!view) return <Skeleton lines={8} label={t('pp.loading')} />;
  // Правка на месте (S4-24, ADR-LORE-047 п. 14.1): сохраняем существующим путём записи и перечитываем
  // паспорт с сервера — показываем записанное, а не то, что набрали.
  const onSave = async ({ field, to }: { field: string; to: unknown }) => {
    // Версия на момент ЧТЕНИЯ записи (S5-08): сервер сверит её и откажет
    // 409-м, если запись успели изменить. Без неё сохранение затирало чужую
    // правку молча. У ADR проверки на сервере нет — там версия не уходит, и
    // С PR #969 проверку принимают все четыре типа, включая ADR.
    await savePassportField(type, { id: view.record.id, title: view.record.title }, field, to, fetchImpl, contract?.record.version ?? null);
    pp.reload();
  };
  // Привязка и отвязка связей (S4-MODEL-PASSPORT-LIST): управление в kit было
  // написано, но хук ему никто не давал — форма привязки просто не рисовалась.
  // Какими связями управлять можно, решает сервер (`manageable` из фасада), а
  // не вид UML: путь привязки есть не у всех. Отказ доходит словами — kit
  // печатает причину рядом с управлением.
  const onRelation = async ({ rel, dir, target, action }: { rel: string; dir: 'out' | 'in'; target: string; action: 'add' | 'remove' }) => {
    await saveRelation({ type, id: view.record.id, rel, dir, target, action }, fetchImpl);
    pp.reload();
  };
  const ctx: KitCtx = { config: { ...view.config, hooks: { ...view.config.hooks, onSave, onRelation } }, data: view.data, role: 'reader', href: x => `#${encodeURIComponent(x)}`, esc, md };
  return (
    <RecordReader record={view.record} ctx={ctx} tab={tab} onTab={setTab} facts={view.facts} mdEditor={MdInlineEdit}
      // Черновик правки — на сервере (S5-09): «Восстановить черновик от
      // ЧЧ:ММ» и автосохранение. Версия записи теперь приходит фасадом
      // (строкой), и `base_version` черновика — та же строка (PR #964),
      // поэтому пометка «запись изменили после черновика» наконец работает:
      // раньше версии в паспорте не было вовсе, и помечать было нечем.
      mdDrafts={field => draftSlot({ api: drafts, type, id: view.record.id, field, version: contract?.record.version ?? null })}
      history={{
        // «Не прочитали» и «запрещено» — разные состояния, и оба не «пусто».
        // useLoadState различает «пусто» и «частично» — вкладке истории эти
        // оттенки не нужны: версий ноль она покажет сама, а предупреждения
        // приходят в warnings ответа. Поэтому и empty, и partial — это 'ok'.
        state: hist.state === 'error'
          ? (hist.error instanceof HistoryForbidden ? 'forbidden' : 'error')
          : hist.state === 'loading' ? 'loading' : 'ok',
        data: hist.data,
        error: hist.error,
        onRetry: hist.reload,
        // «Показать ещё» есть только пока сервер говорит, что дальше есть.
        onMore: hist.data?.page?.has_more ? () => setHistLimit(n => n + HISTORY_PAGE) : undefined,
        loadingMore: hist.state === 'loading' && histLimit > HISTORY_PAGE,
      }}
      placement={placement} loadedAt={contract?.meta.loaded_at} onReload={pp.reload}
      className="list-passport"
      crumbs={backLabel ? <RecordCrumbs back={{ label: backLabel, href: backHref, onClick: onBack }} current={view.record.id} /> : undefined}
      pager={onGo && ids.length > 0 ? <RecordPager ids={ids} current={view.record.id} onGo={onGo} hotkeys={placement === 'full'} /> : undefined}
      tools={onFull ? <button type="button" className="sk-iconbtn list-passport__full" aria-label={t('pp.place.full')} title={t('pp.place.full')} onClick={onFull}>⤢</button> : undefined}
      asideOpen={false} onAside={() => {}} />
  );
}
