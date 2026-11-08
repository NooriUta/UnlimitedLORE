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
import { loadPassport, type PassportType } from './passportAdapters';
import { fromLoreRecord, toLoreRecord } from './loreRecordContract';
import { savePassportField } from './passportSave';

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
  /** id записей списка в порядке показа — для листалки. */
  ids?: readonly string[];
  /** Перейти к соседней записи листалкой. */
  onGo?: (id: string) => void;
  /** «⤢» — развернуть на весь экран; нет — кнопки нет (уже во весь экран). */
  onFull?: () => void;
}

export default function ListPassport({ type, id, placement, fetchImpl, backLabel, onBack, ids = [], onGo, onFull }: ListPassportProps) {
  const t = useAppT();
  const lang = useKitLang();
  const [tab, setTab] = useState('overview');
  const slice = useMemo(() => <T,>(name: string, params?: Record<string, string>) => fetchSlice<T>(name, params, { fetchImpl }), [fetchImpl]);
  const pp = useLoadState(() => loadPassport(type, id, lang, slice), [type, id, lang, slice]);
  const contract = useMemo(() => (pp.data ? toLoreRecord(pp.data, new Date().toISOString(), lang) : null), [pp.data, lang]);
  const view = useMemo(() => (contract ? fromLoreRecord(contract, lang) : null), [contract, lang]);
  if (pp.state === 'error') return <LoadError error={pp.error} onRetry={pp.reload} />;
  if (!view) return <Skeleton lines={8} label={t('pp.loading')} />;
  // Правка на месте (S4-24, ADR-LORE-047 п. 14.1): сохраняем существующим путём записи и перечитываем
  // паспорт с сервера — показываем записанное, а не то, что набрали.
  const onSave = async ({ field, to }: { field: string; to: unknown }) => {
    await savePassportField(type, { id: view.record.id, title: view.record.title }, field, to, fetchImpl);
    pp.reload();
  };
  const ctx: KitCtx = { config: { ...view.config, hooks: { ...view.config.hooks, onSave } }, data: view.data, role: 'reader', href: x => `#${encodeURIComponent(x)}`, esc, md };
  return (
    <RecordReader record={view.record} ctx={ctx} tab={tab} onTab={setTab} facts={view.facts} mdEditor={MdInlineEdit}
      placement={placement} loadedAt={contract?.meta.loaded_at} onReload={pp.reload}
      className="list-passport"
      crumbs={backLabel ? <RecordCrumbs back={{ label: backLabel, onClick: onBack }} current={view.record.id} /> : undefined}
      pager={onGo && ids.length > 0 ? <RecordPager ids={ids} current={view.record.id} onGo={onGo} hotkeys={placement === 'full'} /> : undefined}
      tools={onFull ? <button type="button" className="sk-iconbtn list-passport__full" aria-label={t('pp.place.full')} title={t('pp.place.full')} onClick={onFull}>⤢</button> : undefined}
      asideOpen={false} onAside={() => {}} />
  );
}
