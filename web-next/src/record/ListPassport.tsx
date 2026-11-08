// Паспорт записи, открытый из живого списка v2 (просьба владелицы 08.11: «подключить паспорта
// как есть, дальше улучшим»). Тот же путь, что у демо /kit/passport (S4-33): слайсы →
// loadPassport → toLoreRecord (lore.record/1) → fromLoreRecord → RecordView. Только чтение.
// Свой чанк: MartProse и граф тянут MD-элементы, список за них не платит.
import { useMemo, useState } from 'react';
import { LoadError, RecordView, Skeleton, useKitLang, useLoadState, type KitCtx, type RecordPlacement } from '@seidr/kit';
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
}

export default function ListPassport({ type, id, placement, fetchImpl }: ListPassportProps) {
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
    <RecordView record={view.record} ctx={ctx} tab={tab} onTab={setTab} facts={view.facts} mdEditor={MdInlineEdit}
      placement={placement} loadedAt={contract?.meta.loaded_at} onReload={pp.reload} />
  );
}
