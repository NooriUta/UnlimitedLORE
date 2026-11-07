// Вид выдачи 0.1.0 для SeidrKit.mount (SPRINT_UXR_S10_SEIDR_KIT/K-08):
// список записей слева, карточка выбранной справа — по КОНТРАКТУ ЯДРА
// (kit/src/core/contract.ts). Это минимальный экран single-file HTML; когда
// каркас/списки/запись ядра (K-02..K-04) придут в develop, mount переключается
// на них через опцию view, не меняя своего API.
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { KitConfig, KitCtx, KitData, KitRecord } from '../core/contract';
import { GameIcon } from '../elements';
import { kitT, useKitLang } from '../i18n';
import { EmptyState, LoadError, Skeleton, Truncated } from '../states';
import { pushUrlState, readUrlState } from '../resilience/urlState';
import { MartProse } from '../content/MartProse';
import { SEIDR_KIT_VERSION } from '../version';
import { BlockGuard } from './BlockGuard';

export type MountState =
  | { kind: 'loading' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ready'; data: KitData };

export interface MountViewProps {
  config: KitConfig;
  state: MountState;
  role?: string;
  user?: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Цвет статуса из конфига: имя токена (--suc) или var(--suc). Сырые значения конфиг не несёт. */
function tokenColor(c: string | undefined): string | undefined {
  if (!c) return undefined;
  return c.startsWith('--') ? `var(${c})` : c;
}

function configProblem(config: KitConfig | null | undefined): string | null {
  if (!config || typeof config !== 'object') return 'config: не объект';
  if (!config.kinds || typeof config.kinds !== 'object') return 'config.kinds: нет';
  if (!config.statuses || !Array.isArray(config.statuses.items)) return 'config.statuses.items: нет';
  return null;
}

function renderOut(v: ReactNode | string): ReactNode {
  return typeof v === 'string' ? <p className="sk-mount__text">{v}</p> : v;
}

function fieldText(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

function useUrlParam(name: string): [string | null, (v: string | null) => void] {
  const [val, setVal] = useState<string | null>(() => (typeof window === 'undefined' ? null : readUrlState().get(name)));
  useEffect(() => {
    const on = () => setVal(readUrlState().get(name));
    window.addEventListener('popstate', on);
    window.addEventListener('hashchange', on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener('hashchange', on); };
  }, [name]);
  const set = useCallback((v: string | null) => { pushUrlState({ [name]: v }); setVal(v); }, [name]);
  return [val, set];
}

export function MountView({ config, state, role, user }: MountViewProps) {
  const lang = useKitLang();
  const problem = configProblem(config);
  const data = state.kind === 'ready' ? state.data : null;
  const records = data?.records ?? [];
  const [selId, setSel] = useUrlParam('r');
  const [tab, setTab] = useUrlParam('tab');
  const selected: KitRecord | undefined = records.find((r) => r.id === selId) ?? records[0];

  const ctx = useMemo<KitCtx | null>(() => (data && !problem ? {
    data, config, role, user,
    href: (id: string) => `#r=${encodeURIComponent(id)}`,
    esc,
    md: (s: string) => <MartProse text={s} />,
  } : null), [data, config, role, user, problem]);

  const module = config?.modules?.find((m) => m.status !== 'planned') ?? config?.modules?.[0];

  let body: ReactNode;
  if (problem) {
    body = <LoadError title={kitT(lang, 'kit.mount.badConfig')} error={new Error(problem)} />;
  } else if (state.kind === 'loading') {
    body = <Skeleton lines={4} label={kitT(lang, 'kit.state.loading')} />;
  } else if (state.kind === 'error') {
    body = <LoadError error={state.error} />;
  } else if (records.length === 0) {
    body = <EmptyState />;
  } else {
    body = (
      <div className="sk-mount__split">
        <nav className="sk-mount__list" aria-label={kitT(lang, 'kit.mount.records')}>
          {records.map((r) => {
            const kind = config.kinds[r.kind];
            const st = config.statuses.items.find((s) => s.code === r.status);
            const on = r.id === selected?.id;
            return (
              <button
                key={r.id}
                type="button"
                data-kit-record-item={r.id}
                aria-current={on ? 'true' : undefined}
                className={['sk-mount__item', on && 'is-on'].filter(Boolean).join(' ')}
                onClick={() => { setSel(r.id); setTab(null); }}
              >
                {kind?.icon && <GameIcon slug={kind.icon} size={16} className="sk-mount__icon" />}
                <span className="sk-mount__title">{r.title}</span>
                {st && (
                  <span className="sk-pill sk-pill--value" style={{ '--pill-c': tokenColor(st.color) } as CSSProperties}>{st.title}</span>
                )}
              </button>
            );
          })}
        </nav>
        {selected && ctx && <RecordCard r={selected} ctx={ctx} tab={tab} setTab={setTab} />}
      </div>
    );
  }

  const meta = data?.meta;
  return (
    <div className="sk-mount" data-kit-mount="" data-kit-version={SEIDR_KIT_VERSION}>
      <header className="sk-mount__head">
        {module?.icon && <GameIcon slug={module.icon} size={18} className="sk-mount__icon" />}
        <h1 className="sk-mount__h1">{module?.title ?? 'Seiðr-kit'}</h1>
        {meta?.scope && <span className="sk-pill sk-pill--id">{meta.scope}</span>}
        {meta?.generated_at && <span className="sk-mount__meta">{kitT(lang, 'kit.mount.generatedAt', { at: meta.generated_at })}</span>}
      </header>
      {meta?.errors?.map((e) => (
        <div key={e.block} data-kit-meta-error={e.block}>
          <LoadError compact title={kitT(lang, 'kit.mount.notChecked', { block: e.block })} error={new Error(e.reason)} />
        </div>
      ))}
      {meta && (
        <Truncated
          shown={records.length}
          meta={meta.truncated
            ? { truncated: true, limit: meta.returned }
            : (typeof meta.total === 'number' && meta.total > records.length
              ? { page: { total: meta.total, offset: 0, has_more: true } }
              : null)}
        />
      )}
      {body}
    </div>
  );
}

function RecordCard({ r, ctx, tab, setTab }: { r: KitRecord; ctx: KitCtx; tab: string | null; setTab: (v: string | null) => void }) {
  const lang = useKitLang();
  const kind = ctx.config.kinds[r.kind];
  const tabs = kind?.tabs ?? [];
  const active = tabs.find((t) => t.key === tab);
  const st = ctx.config.statuses.items.find((s) => s.code === r.status);
  return (
    <article className="sk-mount__card" data-kit-record={r.id}>
      <header className="sk-mount__cardhead">
        <h2 className="sk-mount__h2">{r.title}</h2>
        <span className="sk-pill sk-pill--id">{r.id}</span>
        <span className="sk-pill sk-pill--value">{kind?.title ?? r.kind}</span>
        {st && <span className="sk-pill sk-pill--value" style={{ '--pill-c': tokenColor(st.color) } as CSSProperties}>{st.title}</span>}
      </header>
      {tabs.length > 0 && (
        <div role="tablist" className="sk-mount__tabs" aria-label={kitT(lang, 'kit.mount.tabs')}>
          <button type="button" role="tab" aria-selected={!active} className="sk-mount__tab" onClick={() => setTab(null)}>
            {kitT(lang, 'kit.mount.overview')}
          </button>
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={active?.key === t.key} className="sk-mount__tab" onClick={() => setTab(t.key)}>
              {t.title}
            </button>
          ))}
        </div>
      )}
      {active ? (
        <BlockGuard key={`${r.id}:${active.key}`} block={`tab:${active.key}`} lang={lang}>
          <Rendered fn={() => active.render(r, ctx)} />
        </BlockGuard>
      ) : (
        <>
          {kind?.overview && (
            <BlockGuard key={`${r.id}:overview`} block="overview" lang={lang}>
              <Rendered fn={() => kind.overview!(r, ctx)} />
            </BlockGuard>
          )}
          {kind?.fields && kind.fields.length > 0 && (
            <BlockGuard key={`${r.id}:fields`} block="fields" lang={lang}>
              <dl className="sk-mount__fields">
                {kind.fields.map((f) => (
                  <div key={f.key} className="sk-mount__field">
                    <dt>{f.title}</dt>
                    <dd>{f.type === 'md' ? ctx.md(fieldText(r.fields[f.key])) : fieldText(r.fields[f.key])}</dd>
                  </div>
                ))}
              </dl>
            </BlockGuard>
          )}
          {r.body_md && (
            <BlockGuard key={`${r.id}:body`} block="body" lang={lang}>
              {ctx.md(r.body_md)}
            </BlockGuard>
          )}
        </>
      )}
    </article>
  );
}

/** Вызов render внутри дочернего компонента — чтобы его исключение поймал BlockGuard. */
function Rendered({ fn }: { fn: () => ReactNode | string }) {
  return <>{renderOut(fn())}</>;
}
