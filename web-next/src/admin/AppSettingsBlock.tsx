// Блок «Параметры приложения» во «Флагах» админки v2 (SPRINT_UXR_S7B_ADMIN/
// S7B-31 п.4, решение 4а). Перенесено из старой вкладки v1 «Настройки»:
// chart-слой (charts.layer: echarts|volva) и адрес Völva (volva.url) — с
// проверкой интеграции; прочие известные ключи app_setting; неопознанные ключи
// с удалением (soft-delete) через дифф.
import { useState } from 'react';
import { DiffPreview, Forbidden, LoadError, Skeleton, useKitLang, useLoadState } from '@seidr/kit';
import { kitMinute } from '@seidr/kit/core';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import {
  checkVolva, fetchAppSettings, removeSetting, saveSetting, settingError, splitSettings,
  type KnownValue, type SettingError, type VolvaVerdict,
} from './appSettings';
import type { DictRow } from './dicts';
import './Admin.css';

export interface AppSettingsProps {
  fetchImpl?: typeof fetch;
}

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

const INVALID: Record<SettingError, AppKey> = {
  url: 'admin.set.bad.url', choice: 'admin.set.bad.choice', bool: 'admin.set.bad.bool', number: 'admin.set.bad.number',
};

export function AppSettings({ fetchImpl }: AppSettingsProps) {
  const t = useAppT();
  const res = useLoadState<DictRow[]>(s => fetchAppSettings(s, fetchImpl), [fetchImpl]);
  const [error, setError] = useState<string | null>(null);
  const rows = res.data;
  const e = res.error;
  let body;
  if (res.state === 'loading' && !rows) body = <Skeleton lines={4} label={t('admin.set.loading')} />;
  else if (!rows && (res.state === 'forbidden' || (e instanceof LoreHttpError && (e.status === 401 || e.status === 403)))) {
    body = <Forbidden compact reason={reasonOf(e)} />;
  } else if (!rows) body = <LoadError compact error={e} onRetry={res.reload} />;
  else {
    const { known, unknown } = splitSettings(rows);
    const done = () => { setError(null); res.reload(); };
    body = (
      <>
        <div className="adm-tablewrap">
          <table className="adm-table" data-testid="adm-settings">
            <caption className="sk-sr">{t('admin.set.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('admin.set.col.key')}</th>
                <th scope="col">{t('admin.set.col.value')}</th>
                <th scope="col">{t('admin.set.col.descr')}</th>
                <th scope="col"><span className="sk-sr">{t('admin.set.col.act')}</span></th>
              </tr>
            </thead>
            <tbody>
              {known.map(k => <KnownRow key={k.def.key} k={k} fetchImpl={fetchImpl} onSaved={done} onError={setError} />)}
            </tbody>
          </table>
        </div>
        {error && <p className="adm-note" data-tone="dng" role="alert" data-testid="adm-set-error">{t('admin.set.saveError', { reason: error })}</p>}
        {unknown.length > 0 && <UnknownKeys rows={unknown} fetchImpl={fetchImpl} onDone={done} />}
      </>
    );
  }
  return (
    <section aria-labelledby="adm-set-h">
      <h3 id="adm-set-h" className="adm-access__h">{t('admin.set.title')}</h3>
      <p className="adm-hint">{t('admin.set.lead')}</p>
      {body}
      <VolvaCheck fetchImpl={fetchImpl} />
    </section>
  );
}

function KnownRow({ k, fetchImpl, onSaved, onError }: {
  k: KnownValue; fetchImpl?: typeof fetch; onSaved: () => void; onError: (r: string | null) => void;
}) {
  const t = useAppT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<SettingError | null>(null);
  const d = k.def;
  const open = () => { setDraft(k.value ?? (d.kind === 'choice' ? d.choices![0] : '')); setBad(null); setEditing(true); };
  const save = () => {
    const err = settingError(d.key, draft);
    setBad(err);
    if (err || busy) return;
    setBusy(true);
    onError(null);
    saveSetting(d.key, draft, fetchImpl).then(
      () => { setBusy(false); setEditing(false); onSaved(); },
      (e: unknown) => { setBusy(false); onError(reasonOf(e)); },
    );
  };
  return (
    <tr data-testid={`adm-set-${d.key}`}>
      <th scope="row"><span className="adm-mono">{d.key}</span></th>
      <td>
        {editing ? (
          <span className="adm-field">
            {d.kind === 'choice' ? (
              <select className="adm-select" aria-label={d.key} value={draft} disabled={busy} onChange={e => setDraft(e.target.value)}>
                {d.choices!.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ) : (
              <input className="adm-input adm-mono" type="text" aria-label={d.key} value={draft} placeholder={d.placeholder} disabled={busy}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
            )}
            {bad && <span className="adm-err" data-testid="adm-set-invalid">{t(INVALID[bad])}</span>}
            <span className="adm-hint">{t(d.hint)}</span>
          </span>
        ) : (
          <span data-testid="adm-set-value" data-state={k.value === null ? 'unset' : 'set'}>
            {k.value === null ? <span className="adm-missing">{t('admin.set.notSet')}</span> : <span className="adm-mono">{k.value}</span>}
          </span>
        )}
      </td>
      <td>
        {t(d.descr)}
        <p className="adm-hint">{t('admin.set.typeDef', { type: t(d.type), def: t(d.def) })}</p>
      </td>
      <td>
        {editing ? (
          <span className="adm-field--btns">
            <button type="button" className="adm-btn" disabled={busy} onClick={save}>{t('admin.set.save')}</button>
            <button type="button" className="adm-btn" disabled={busy} onClick={() => setEditing(false)}>{t('admin.set.cancel')}</button>
          </span>
        ) : (
          <button type="button" className="adm-btn" onClick={open}>{t('admin.set.edit')}</button>
        )}
      </td>
    </tr>
  );
}

function UnknownKeys({ rows, fetchImpl, onDone }: { rows: DictRow[]; fetchImpl?: typeof fetch; onDone: () => void }) {
  const t = useAppT();
  const lang = useKitLang();
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    if (!pick || busy) return;
    setBusy(true);
    setError(null);
    removeSetting(pick, fetchImpl).then(
      () => { setBusy(false); setPick(null); onDone(); },
      (e: unknown) => { setBusy(false); setError(reasonOf(e)); },
    );
  };
  return (
    <div className="adm-card" data-testid="adm-set-unknown">
      <p className="adm-note" data-tone="wrn">{t('admin.set.unknownH', { n: rows.length })}</p>
      <p className="adm-hint">{t('admin.set.unknownB')}</p>
      <table className="adm-table">
        <tbody>
          {rows.map(r => (
            <tr key={r.code}>
              <th scope="row"><span className="adm-mono">{r.code}</span></th>
              <td><span className="adm-mono">{r.label_ru ?? '—'}</span></td>
              <td>
                <button type="button" className="adm-btn adm-btn--dng" disabled={busy} aria-pressed={pick === r.code}
                  onClick={() => setPick(pick === r.code ? null : r.code)}>{t('admin.set.remove')}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pick && (
        <DiffPreview key={pick} lang={lang} busy={busy} onApply={apply} label={t('admin.set.removeDiff')}
          rows={[{ id: pick, kind: 'remove', text: pick, detail: t('admin.set.removeDetail'), check: { state: 'checked' } }]} />
      )}
      {error && <p className="adm-note" data-tone="dng" role="alert">{t('admin.set.saveError', { reason: error })}</p>}
    </div>
  );
}

const VERDICT: Record<Exclude<VolvaVerdict['kind'], 'ok'>, AppKey> = {
  not_configured: 'admin.set.volva.notConfigured',
  unknown_chart: 'admin.set.volva.unknownChart',
  forbidden: 'admin.set.volva.forbidden',
  error: 'admin.set.volva.error',
};

function VolvaCheck({ fetchImpl }: { fetchImpl?: typeof fetch }) {
  const t = useAppT();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState<VolvaVerdict | null>(null);
  const run = () => {
    setBusy(true);
    setV(null);
    checkVolva(fetchImpl).then(r => { setV(r); setBusy(false); });
  };
  const expires = v?.kind === 'ok' ? (kitMinute(v.expires)?.text ?? v.expires) : '';
  return (
    <div className="adm-card">
      <div className="adm-field--btns">
        <button type="button" className="adm-btn" disabled={busy} onClick={run}>{t('admin.set.volva.btn')}</button>
        <span className="adm-hint">{t('admin.set.volva.note')}</span>
      </div>
      {v && (
        <p className="adm-note" data-tone={v.kind === 'ok' ? 'inf' : v.kind === 'error' ? 'dng' : 'wrn'} role="status"
          data-testid="adm-volva-verdict" data-kind={v.kind}>
          {v.kind === 'ok'
            ? t('admin.set.volva.ok', { origin: v.origin, expires })
            : t(VERDICT[v.kind], { d: v.detail })}
        </p>
      )}
    </div>
  );
}
