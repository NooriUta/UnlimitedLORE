// Демо паспортов на реальных объектах LORE (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-33), маршрут /kit/passport.
// Раскладка — решение владелицы 08.11 (RecordView placement): «панелью справа» — всё вкладками;
// «снизу» и «на весь экран» — вкладки записи справа, вычисляемое колонкой слева.
// Тип, запись и место — в адресе (?type=&id=&place=), как всё состояние v2.
// Только чтение: правка и создание — после ADR по контракту (SPEC-LORE-UXR-RECORD-CONTRACT).
import { useEffect, useMemo, useState } from 'react';
import {
  LoadError, RecordDock, RecordView, ScreenHead, Segmented, Skeleton, pushUrlState, readUrlState, useKitLang, useLoadState,
  type KitCtx, type RecordPlacement,
} from '@seidr/kit';
import { MartProse } from '@seidr/kit/content';
import { fetchSlice } from '../api/loreClient';
import { useAppT, type AppKey } from '../i18n';
import { PASSPORT_TYPES, listOf, loadPassport, type PassportType } from '../record/passportAdapters';
import './PassportDemo.css';

const PLACES: RecordPlacement[] = ['right', 'bottom', 'full'];
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const md = (s: string) => <MartProse text={s} />;

function initial() {
  const p = typeof window === 'undefined' ? new URLSearchParams() : readUrlState(window);
  const type = (PASSPORT_TYPES as readonly string[]).includes(p.get('type') ?? '') ? (p.get('type') as PassportType) : 'sprint';
  const place = (PLACES as string[]).includes(p.get('place') ?? '') ? (p.get('place') as RecordPlacement) : 'bottom';
  return { type, id: p.get('id') ?? '', place, tab: p.get('tab') ?? 'overview' };
}

export default function PassportDemo({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const lang = useKitLang();
  const [st, setSt] = useState(initial);
  const set = (patch: Partial<typeof st>) => {
    setSt(s => {
      const next = { ...s, ...patch };
      if (typeof window !== 'undefined') pushUrlState({ type: next.type, id: next.id || null, place: next.place, tab: next.tab === 'overview' ? null : next.tab }, { replace: true });
      return next;
    });
  };
  const slice = useMemo(() => <T,>(name: string, params?: Record<string, string>) => fetchSlice<T>(name, params, { fetchImpl }), [fetchImpl]);
  const list = useLoadState(() => listOf(st.type, slice), [st.type, slice]);
  useEffect(() => { if (!st.id && list.data?.length) set({ id: list.data[0].id }); }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const pp = useLoadState(() => (st.id ? loadPassport(st.type, st.id, lang, slice) : Promise.resolve(null)), [st.type, st.id, lang, slice]);
  const [loadedAt, setLoadedAt] = useState<string | undefined>();
  useEffect(() => { if (pp.data) setLoadedAt(new Date().toISOString()); }, [pp.data]);

  const ctx: KitCtx | null = pp.data ? { config: pp.data.config, data: pp.data.data, role: 'reader', href: id => `#${encodeURIComponent(id)}`, esc, md } : null;
  return (
    <main className="pp-demo" data-testid="passport-demo">
      <ScreenHead title={t('pp.title')} titleId="pp-title" />
      <p className="pp-demo__lead">{t('pp.lead')}</p>
      <div className="pp-demo__bar">
        <Segmented label={t('pp.type')} value={st.type} onChange={v => set({ type: v as PassportType, id: '', tab: 'overview' })}
          options={PASSPORT_TYPES.map(x => ({ value: x, label: t(`pp.kind.${x}` as AppKey) }))} />
        <label className="pp-demo__pick">
          <span>{t('pp.record')}</span>
          <select value={st.id} onChange={e => set({ id: e.target.value, tab: 'overview' })} disabled={!list.data}>
            {(list.data ?? []).map(o => <option key={o.id} value={o.id}>{o.id} — {o.title}</option>)}
          </select>
        </label>
        <Segmented label={t('pp.place')} value={st.place} onChange={v => set({ place: v as RecordPlacement })}
          options={PLACES.map(x => ({ value: x, label: t(`pp.place.${x}` as AppKey) }))} />
      </div>
      {list.state === 'error' && <LoadError error={list.error} onRetry={list.reload} />}
      <RecordDock placement={st.place} backdrop={<ul className="pp-demo__list">{(list.data ?? []).slice(0, 14).map(o => <li key={o.id}>{o.id}</li>)}</ul>}>
        {pp.state === 'error' ? <LoadError error={pp.error} onRetry={pp.reload} />
          : !pp.data || !ctx ? <Skeleton lines={8} label={t('pp.loading')} />
            : (
              <RecordView record={pp.data.record} ctx={ctx} tab={st.tab} onTab={tab => set({ tab })} facts={pp.data.facts}
                placement={st.place} loadedAt={loadedAt} onReload={pp.reload} />
            )}
      </RecordDock>
    </main>
  );
}
