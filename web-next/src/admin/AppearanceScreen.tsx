// Раздел «Оформление» админки v2 ([[task:SPRINT_LORE_ADMIN_POLISH/AP-APPEARANCE]]; прототип
// docs/prototypes/admin-appearance.html, одобрен владельцем 25.11.2026: «the recommendation is ok»).
//   • «Стили» — наши палитры и пары шрифтов (в бандле, обязательные — замок) и свои стили установки: загрузка
//     JSON или CSS-переменных, проверка СЕРВЕРОМ до сохранения (недопустимое — отказ с причинами), включатель;
//   • «Шрифты и палитра» — на установку: умолчание и разрешённый набор палитр и пар шрифтов (решение 2в); каждый
//     человек выбирает внутри набора у себя в «Виде» (личный выбор сохраняется).
// Вкладка и предпросмотр — в адресе (?adm-app-tab, ?adm-app-pv): ссылка открывает то же самое.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  Forbidden, GameIcon, LoadError, Pill, Skeleton, ownStyleVars, useLoadState, useUrlParam, type OwnStyleTokens,
} from '@seidr/kit';
import { useAppT, type AppKey } from '../i18n';
import { LoreHttpError } from '../api/loreSlice';
import { fetchDicts, type DictsData } from './dicts';
import {
  BUILTIN_PALETTES, FONT_PAIRS, addOwnStyle, builtinLabel, checkStyle, installOf, ownCode, ownStylesOf, saveInstall,
  setOwnActive, type InstallAppearance, type OwnStyle, type StyleCheck,
} from './appearance';
import './Admin.css';

export interface AppearanceScreenProps {
  fetchImpl?: typeof fetch;
}

const reasonOf = (e: unknown): string =>
  e instanceof LoreHttpError ? (e.detail || e.message) : e instanceof Error ? e.message : String(e ?? '');

const FONT_LABEL: Record<'pair' | 'mono', AppKey> = {
  pair: 'admin.appearance.font.pair',
  mono: 'admin.appearance.font.mono',
};

/** Предел файла своего стиля — как у сервера (LoreAppearance.SOURCE_MAX). */
const SOURCE_MAX = 64 * 1024;

export function AppearanceScreen({ fetchImpl }: AppearanceScreenProps) {
  const t = useAppT();
  const [tab, setTab] = useUrlParam('adm-app-tab');
  const pick = tab === 'pick';
  const res = useLoadState<DictsData>(s => fetchDicts(s, fetchImpl), [fetchImpl], { rows: d => d.rows });
  let body: ReactNode;
  if (res.state === 'loading' && !res.data) body = <Skeleton lines={6} label={t('admin.appearance.loading')} />;
  else if (!res.data && (res.state === 'forbidden' || (res.error instanceof LoreHttpError && (res.error.status === 401 || res.error.status === 403))))
    body = <Forbidden reason={reasonOf(res.error)} />;
  else if (!res.data) body = <LoadError error={res.error} onRetry={res.reload} />;
  else body = pick
    ? <PickPane data={res.data} fetchImpl={fetchImpl} reload={res.reload} />
    : <StylesPane data={res.data} fetchImpl={fetchImpl} reload={res.reload} />;
  return (
    <section className="adm" aria-labelledby="adm-appearance-h">
      <h2 id="adm-appearance-h" className="adm-h">{t('admin.appearance.title')}</h2>
      <p className="adm-lead">{t('admin.appearance.lead')}</p>
      <div className="adm-tabs" role="tablist" aria-label={t('admin.appearance.title')}>
        <button type="button" role="tab" className="adm-tab" aria-selected={!pick} aria-current={!pick ? 'page' : undefined}
          data-testid="ap-tab-styles" onClick={() => setTab(null, { replace: true })}>
          <GameIcon slug="paint-brush" size={14} /> {t('admin.appearance.tabStyles')}
        </button>
        <button type="button" role="tab" className="adm-tab" aria-selected={pick} aria-current={pick ? 'page' : undefined}
          data-testid="ap-tab-pick" onClick={() => setTab('pick', { replace: true })}>
          <GameIcon slug="palette" size={14} /> {t('admin.appearance.tabPick')}
        </button>
      </div>
      {body}
    </section>
  );
}

// ── предпросмотр ──────────────────────────────────────────────────────────────

interface PreviewProps { palette: string; own?: OwnStyleTokens | null; mode: 'dark' | 'light'; font: 'pair' | 'mono' }

/** Кусочек интерфейса в выбранной палитре, режиме и паре шрифтов: блоки темы kit работают и на вложенном узле. */
function Preview({ palette, own, mode, font }: PreviewProps) {
  const t = useAppT();
  const style = (own ? ownStyleVars(own, mode) : {}) as CSSProperties;
  const rows: [string, string, AppKey][] = [
    ['FN-12', 'active', 'admin.appearance.pv.active'],
    ['FN-13', 'done', 'admin.appearance.pv.done'],
    ['FN-14', 'blocked', 'admin.appearance.pv.blocked'],
  ];
  return (
    <div className="ap-pv" data-theme={own ? 'amber-forest' : palette} data-mode={mode === 'light' ? 'light' : undefined}
      data-font={font === 'mono' ? 'mono' : undefined} style={style} data-testid="ap-preview">
      <div className="ap-pv__bar"><span className="ap-pv__logo">LORE</span><span className="ap-pv__nav">{t('admin.appearance.pv.nav')}</span></div>
      <div className="ap-pv__body">
        <div className="ap-pv__h">{t('admin.appearance.pv.title')}</div>
        <div className="ap-pv__p">{t('admin.appearance.pv.text')}</div>
        <table className="ap-pv__tbl">
          <tbody>
            {rows.map(([id, st, label]) => (
              <tr key={id}><td className="ap-pv__id">{id}</td><td><span className="ap-pv__st" style={{ color: `var(--st-${st})` }}>{t(label)}</span></td></tr>
            ))}
          </tbody>
        </table>
        <div className="ap-pv__row">
          <Pill tone="acc">{t('admin.appearance.pv.acc')}</Pill>
          <Pill tone="suc">{t('admin.appearance.pv.suc')}</Pill>
          <Pill tone="wrn">{t('admin.appearance.pv.wrn')}</Pill>
          <Pill tone="dng">{t('admin.appearance.pv.dng')}</Pill>
          <Pill tone="inf">{t('admin.appearance.pv.inf')}</Pill>
        </div>
        <div className="ap-pv__code">task_set SPRINT_X/FN-12 → ready_for_deploy</div>
      </div>
    </div>
  );
}

function ModeSwitch({ mode, onMode, disabled }: { mode: 'dark' | 'light'; onMode: (m: 'dark' | 'light') => void; disabled?: boolean }) {
  const t = useAppT();
  return (
    <div className="adm-chips" role="group" aria-label={t('admin.appearance.mode')}>
      {(['dark', 'light'] as const).map(m => (
        <button key={m} type="button" className="adm-chip" aria-pressed={mode === m} disabled={disabled} onClick={() => onMode(m)}>
          {t(m === 'dark' ? 'admin.appearance.mode.dark' : 'admin.appearance.mode.light')}
        </button>
      ))}
    </div>
  );
}

const Swatch = ({ color }: { color: string }) => <span className="ap-sw" style={{ background: color }} aria-hidden="true" />;

const Lock = () => {
  const t = useAppT();
  return <span className="ap-lock" data-testid="ap-lock" title={t('admin.appearance.locked')}><GameIcon slug="padlock" size={14} label={t('admin.appearance.locked')} /></span>;
};

// ── «Стили» ───────────────────────────────────────────────────────────────────

function StylesPane({ data, fetchImpl, reload }: { data: DictsData; fetchImpl?: typeof fetch; reload: () => void }) {
  const t = useAppT();
  const own = useMemo(() => ownStylesOf(data.rows), [data.rows]);
  const inst = useMemo(() => installOf(data.rows, own), [data.rows, own]);
  const [pv, setPv] = useUrlParam('adm-app-pv');
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const [name, setName] = useState('');
  const [src, setSrc] = useState('');
  const [check, setCheck] = useState<StyleCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const shownOwn = own.find(o => o.code === pv) ?? null;
  const draft = check?.ok ? check.tokens : null;
  const pvPalette = shownOwn ? shownOwn.code : pv && BUILTIN_PALETTES.includes(pv) ? pv : inst.paletteDefault;
  const pvOwn = draft ?? shownOwn?.tokens ?? own.find(o => o.code === pvPalette)?.tokens ?? null;
  const pvName = draft ? t('admin.appearance.draft', { name: name.trim() || t('admin.appearance.newStyle') })
    : shownOwn ? shownOwn.name : builtinLabel(data.rows, pvPalette);

  const runCheck = () => {
    setBusy(true); setError(null); setDone(null);
    checkStyle(src, fetchImpl).then(
      r => { setCheck(r); setBusy(false); },
      e => { setCheck(null); setBusy(false); setError(reasonOf(e)); },
    );
  };
  const add = () => {
    if (!check?.ok || !name.trim() || busy) return;
    const code = ownCode(name, own.map(o => o.code));
    setBusy(true); setError(null);
    addOwnStyle(code, name, src, (own.length + 1) * 10 + 100, fetchImpl).then(
      () => { setBusy(false); setDone(t('admin.appearance.added', { name: name.trim() })); setName(''); setSrc(''); setCheck(null); setPv(code, { replace: true }); reload(); },
      e => { setBusy(false); setError(reasonOf(e)); },
    );
  };
  const toggle = (o: OwnStyle) => {
    setError(null);
    setOwnActive(o.code, !o.active, fetchImpl).then(() => reload(), e => setError(reasonOf(e)));
  };
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > SOURCE_MAX) { setError(t('admin.appearance.fileTooBig')); return; }
    void f.text().then(text => { setSrc(text); setCheck(null); if (!name.trim()) setName(f.name.replace(/\.(json|css)$/i, '')); });
  };

  return (
    <div className="ap-grid">
      <div className="ap-col">
        <div className="adm-card" data-testid="ap-ours">
          <h3 className="ap-h"><GameIcon slug="padlock" size={14} />{t('admin.appearance.ours')}</h3>
          <p className="adm-hint">{t('admin.appearance.oursLead')}</p>
          <p className="ap-th">{t('admin.appearance.palettesN', { n: BUILTIN_PALETTES.length })}</p>
          {BUILTIN_PALETTES.map(code => (
            <div key={code} className="ap-row">
              <Swatch color={`var(--swatch-${code})`} />
              <div className="ap-row__main">
                <div className="ap-row__name">{builtinLabel(data.rows, code)}</div>
                <div className="ap-row__meta">{code}</div>
              </div>
              {inst.paletteDefault === code && <Pill tone="acc">{t('admin.appearance.default')}</Pill>}
              <button type="button" className="adm-btn" aria-pressed={pvPalette === code && !draft}
                onClick={() => setPv(code, { replace: true })}>{t('admin.appearance.preview')}</button>
              <Lock />
            </div>
          ))}
          <p className="ap-th">{t('admin.appearance.fontsN', { n: FONT_PAIRS.length })}</p>
          {FONT_PAIRS.map(f => (
            <div key={f} className="ap-row" data-font={f === 'mono' ? 'mono' : undefined}>
              <span className="ap-aa">Aa</span>
              <div className="ap-row__main">
                <div className="ap-row__name">{t(FONT_LABEL[f])}</div>
                <div className="ap-row__meta">{f}</div>
              </div>
              {inst.fontDefault === f && <Pill tone="acc">{t('admin.appearance.default')}</Pill>}
              <Lock />
            </div>
          ))}
        </div>

        <div className="adm-card">
          <h3 className="ap-h"><GameIcon slug="upload" size={14} />{t('admin.appearance.own')}</h3>
          <p className="adm-hint">{t('admin.appearance.ownLead')}</p>
          <div className="ap-drop">
            <label className="adm-field">
              <span className="adm-field__l">{t('admin.appearance.name')}</span>
              <input className="adm-input" type="text" aria-label={t('admin.appearance.name')} value={name}
                placeholder={t('admin.appearance.namePh')} onChange={e => setName(e.target.value)} />
            </label>
            <label className="adm-field">
              <span className="adm-field__l">{t('admin.appearance.source')}</span>
              <textarea className="adm-input ap-ta" aria-label={t('admin.appearance.source')} value={src} spellCheck={false}
                placeholder={t('admin.appearance.sourcePh')} onChange={e => { setSrc(e.target.value); setCheck(null); }} />
            </label>
            <div className="adm-field--btns">
              <label className="adm-btn">
                <GameIcon slug="files" size={14} /> {t('admin.appearance.file')}
                <input type="file" accept=".json,.css,application/json,text/css" hidden onChange={e => onFile(e.target.files?.[0])} />
              </label>
              <button type="button" className="adm-btn" disabled={busy || !src.trim()} onClick={runCheck}>{t('admin.appearance.check')}</button>
              <button type="button" className="adm-btn" data-tone="acc" disabled={busy || !check?.ok || !name.trim()} onClick={add}>{t('admin.appearance.add')}</button>
            </div>
            {check && (
              <ul className="ap-check" aria-live="polite" data-testid="ap-check">
                <li data-tone={check.ok ? 'suc' : 'dng'}>
                  {check.ok ? t('admin.appearance.checkOk', { n: Object.keys(check.tokens.root).length + Object.keys(check.tokens.light ?? {}).length })
                    : t('admin.appearance.checkBad', { n: check.errors.length })}
                </li>
                {check.errors.map(e => <li key={e} data-tone="dng">{e}</li>)}
                {check.warnings.map(w => <li key={w} data-tone="wrn">{w}</li>)}
              </ul>
            )}
            {error && <p className="adm-note" data-tone="dng" role="alert">{t('admin.appearance.saveError', { reason: error })}</p>}
            {done && <p className="adm-note" data-tone="inf" role="status">{done}</p>}
          </div>
          <p className="ap-th">{t('admin.appearance.loaded')}</p>
          <div data-testid="ap-own-list">
            {own.length === 0 && <p className="adm-hint">{t('admin.appearance.noOwn')}</p>}
            {own.map(o => (
              <div key={o.code} className="ap-row">
                <input type="checkbox" className="ap-toggle" checked={o.active} aria-label={o.name} onChange={() => toggle(o)} />
                <span className="ap-sw4" aria-hidden="true">
                  {['--bg0', '--bg2', '--acc', '--t1'].map(k => <i key={k} style={{ background: o.tokens.root[k] ?? 'transparent' }} />)}
                </span>
                <div className="ap-row__main">
                  <div className="ap-row__name">{o.name}</div>
                  <div className="ap-row__meta">
                    {o.code} · {o.broken ? t('admin.appearance.broken')
                      : t(o.active ? 'admin.appearance.ownOn' : 'admin.appearance.ownOff', { n: Object.keys(o.tokens.root).length })}
                  </div>
                </div>
                {inst.paletteDefault === o.code && <span data-testid={`ap-default-${o.code}`}><Pill tone="acc">{t('admin.appearance.default')}</Pill></span>}
                <button type="button" className="adm-btn" disabled={o.broken} onClick={() => setPv(o.code, { replace: true })}>{t('admin.appearance.preview')}</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="adm-card ap-sticky">
        <h3 className="ap-h">{t('admin.appearance.preview')} <Pill>{pvName}</Pill></h3>
        <ModeSwitch mode={mode} onMode={setMode} />
        <Preview palette={pvPalette} own={pvOwn} mode={mode} font={inst.fontDefault} />
      </div>
    </div>
  );
}

// ── «Шрифты и палитра» на установку ───────────────────────────────────────────

function PickPane({ data, fetchImpl, reload }: { data: DictsData; fetchImpl?: typeof fetch; reload: () => void }) {
  const t = useAppT();
  const own = useMemo(() => ownStylesOf(data.rows), [data.rows]);
  const saved = useMemo(() => installOf(data.rows, own), [data.rows, own]);
  const [v, setV] = useState<InstallAppearance>(saved);
  const [mode, setMode] = useState<'dark' | 'light'>('dark');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: 'inf' | 'dng'; text: string } | null>(null);
  const palettes = [
    ...BUILTIN_PALETTES.map(code => ({ code, label: builtinLabel(data.rows, code), swatch: `var(--swatch-${code})` })),
    ...own.filter(o => o.active && !o.broken).map(o => ({ code: o.code, label: o.name, swatch: o.tokens.root['--acc'] ?? 'transparent' })),
  ];
  const toggle = <T extends string>(list: T[], code: T): T[] => (list.includes(code) ? list.filter(c => c !== code) : [...list, code]);
  const ordered = <T extends string>(known: readonly T[], list: T[]) => known.filter(k => list.includes(k));
  const save = () => {
    setBusy(true); setNote(null);
    saveInstall(v, fetchImpl).then(
      () => { setBusy(false); setNote({ tone: 'inf', text: t('admin.appearance.saved') }); reload(); },
      e => { setBusy(false); setNote({ tone: 'dng', text: t('admin.appearance.saveError', { reason: reasonOf(e) }) }); },
    );
  };
  const ownTokens = own.find(o => o.code === v.paletteDefault)?.tokens ?? null;

  return (
    <div className="ap-grid">
      <div className="ap-col">
        <div className="adm-card">
          <h3 className="ap-h">{t('admin.appearance.scope')}</h3>
          <p className="adm-hint">{t('admin.appearance.scopeLead')}</p>
        </div>
        <div className="adm-card" data-testid="ap-allowed-palettes">
          <h3 className="ap-h">{t('admin.appearance.palettes')}</h3>
          <p className="adm-hint">{t('admin.appearance.palettesLead')}</p>
          {palettes.map(p => {
            const on = v.palettesAllowed.includes(p.code);
            return (
              <div key={p.code} className="ap-row">
                <input type="checkbox" checked={on} disabled={busy || v.paletteDefault === p.code} aria-label={p.label}
                  onChange={() => setV({ ...v, palettesAllowed: ordered(palettes.map(x => x.code), toggle(v.palettesAllowed, p.code)) })} />
                <input type="radio" name="ap-def-pal" checked={v.paletteDefault === p.code} disabled={busy || !on}
                  aria-label={t('admin.appearance.makeDefault', { name: p.label })} onChange={() => setV({ ...v, paletteDefault: p.code })} />
                <Swatch color={p.swatch} />
                <div className="ap-row__main"><div className="ap-row__name">{p.label}</div><div className="ap-row__meta">{p.code}</div></div>
                {v.paletteDefault === p.code && <Pill tone="acc">{t('admin.appearance.default')}</Pill>}
              </div>
            );
          })}
        </div>
        <div className="adm-card" data-testid="ap-allowed-fonts">
          <h3 className="ap-h">{t('admin.appearance.fonts')}</h3>
          <p className="adm-hint">{t('admin.appearance.fontsLead')}</p>
          {FONT_PAIRS.map(f => {
            const on = v.fontsAllowed.includes(f);
            return (
              <div key={f} className="ap-row" data-font={f === 'mono' ? 'mono' : undefined}>
                <input type="checkbox" checked={on} disabled={busy || v.fontDefault === f} aria-label={t(FONT_LABEL[f])}
                  onChange={() => setV({ ...v, fontsAllowed: ordered(FONT_PAIRS, toggle(v.fontsAllowed, f)) })} />
                <input type="radio" name="ap-def-font" checked={v.fontDefault === f} disabled={busy || !on}
                  aria-label={t('admin.appearance.makeDefault', { name: f })} onChange={() => setV({ ...v, fontDefault: f })} />
                <span className="ap-aa">Aa</span>
                <div className="ap-row__main"><div className="ap-row__name">{t(FONT_LABEL[f])}</div><div className="ap-row__meta">{f}</div></div>
                {v.fontDefault === f && <Pill tone="acc">{t('admin.appearance.default')}</Pill>}
              </div>
            );
          })}
        </div>
      </div>
      <div className="adm-card ap-sticky">
        <h3 className="ap-h">{t('admin.appearance.preview')}</h3>
        <ModeSwitch mode={mode} onMode={setMode} />
        <Preview palette={v.paletteDefault} own={ownTokens} mode={mode} font={v.fontDefault} />
        <div className="adm-field--btns ap-acts">
          <button type="button" className="adm-btn" data-tone="acc" disabled={busy} onClick={save}>{t('admin.appearance.saveInstall')}</button>
          <button type="button" className="adm-btn" disabled={busy} onClick={() => { setV(saved); setNote(null); }}>{t('admin.appearance.reset')}</button>
        </div>
        {note && <p className="adm-note" data-tone={note.tone} role={note.tone === 'dng' ? 'alert' : 'status'}>{note.text}</p>}
      </div>
    </div>
  );
}
