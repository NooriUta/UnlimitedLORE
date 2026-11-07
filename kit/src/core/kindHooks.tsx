// Хуки рендера по виду записи (SPRINT_UXR_S10_SEIDR_KIT/K-10).
// Приложение описывает вид записи в конфиге: kinds.X.overview(record, ctx) —
// «обзор», kinds.X.tabs[{key,title,render}] — свои вкладки карточки. Kit сам
// решает, где и когда их вызвать, и даёт каждому хуку один и тот же ctx:
//   ctx.data   — X_DATA (records/edges/journal/meta, форма ответа сервера);
//   ctx.href   — ссылка на запись (по умолчанию состояние в hash: '#record=…',
//                работает и в single-file HTML на file://, где pushState нет);
//   ctx.esc    — экранирование для хуков, собирающих HTML строкой;
//   ctx.md     — чтение markdown тем же рендером, что v1 (MartProse; KaTeX
//                подключает K-13 — приложение передаёт свой md в createKitCtx).
// Хук может вернуть React-узел или строку. Строка — HTML из конфига
// приложения: вставляется только через санитайзер (скрипты, on*-обработчики и
// javascript:-ссылки срезаются), поэтому пользовательские значения внутри неё
// хук обязан пропустить через ctx.esc.
// Изоляция ошибок: каждый хук рендерится в своём KindBlock — исключение
// превращает в плашку ошибки (errBlock) только этот блок, с именем блока и
// причиной и кнопкой «Повторить»; соседние блоки, вкладки и экран живы.
import { Component, type ReactNode } from 'react';
import type { KitConfig, KitCtx, KitData, KitRecord } from './contract';
import { sanitizeMd } from '../content/sanitizeHtml';
import { MartProse } from '../content/MartProse';
import { LoadError } from '../states/StateViews';
import { Tabs } from '../shell/Tabs';
import { kitT } from '../i18n';
import { useKitLang } from '../i18n/lang';

export type KindRender = (r: KitRecord, ctx: KitCtx) => ReactNode | string;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Экранирование для хуков, собирающих HTML строкой. null/undefined — пусто. */
export function escHtml(s: string): string {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, ch => ESC[ch]);
}

/** Ссылка на запись по умолчанию: состояние в hash (фолбэк «#», S4-00f). */
export function defaultRecordHref(id: string): string {
  return `#record=${encodeURIComponent(id)}`;
}

function defaultMd(s: string): ReactNode {
  return <MartProse text={s} />;
}

export interface CreateKitCtxInput {
  data: KitData;
  config: KitConfig;
  role?: string;
  user?: string;
  href?: (id: string) => string;
  md?: (s: string) => ReactNode;
}

/** Собирает ctx, общий для всех хуков вида (overview, tabs, verdict, palette). */
export function createKitCtx({ data, config, role, user, href, md }: CreateKitCtxInput): KitCtx {
  return { data, config, role, user, href: href ?? defaultRecordHref, esc: escHtml, md: md ?? defaultMd };
}

function errorText(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  return typeof err === 'string' ? err : String(err);
}

/** Результат хука → узел: строка идёт через санитайзер, null/false — пусто. */
function HookOutput({ render, record, ctx }: { render: KindRender; record: KitRecord; ctx: KitCtx }) {
  const out = render(record, ctx);
  if (out == null || out === false) return null;
  if (typeof out === 'string') return <div className="sk-hook" dangerouslySetInnerHTML={{ __html: sanitizeMd(out) }} />;
  return <>{out}</>;
}

function BlockError({ id, error, onRetry }: { id: string; error: unknown; onRetry: () => void }) {
  const lang = useKitLang();
  return (
    <LoadError
      compact
      className="sk-errblock"
      title={kitT(lang, 'kit.hook.error.title', { block: id })}
      hint={kitT(lang, 'kit.hook.error.hint')}
      error={errorText(error)}
      onRetry={onRetry}
    />
  );
}

interface BlockProps {
  /** Имя блока в плашке ошибки: 'overview', ключ вкладки… */
  id: string;
  record: KitRecord;
  ctx: KitCtx;
  render: KindRender;
}

interface BlockState { error: unknown; failed: boolean }

/** Один хук = один блок со своей границей ошибок (errBlock). */
export class KindBlock extends Component<BlockProps, BlockState> {
  state: BlockState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BlockState {
    return { error, failed: true };
  }

  componentDidUpdate(prev: BlockProps) {
    // Другая запись или другой хук — прошлая ошибка к ним не относится.
    if (this.state.failed && (prev.record !== this.props.record || prev.render !== this.props.render)) {
      this.setState({ error: null, failed: false });
    }
  }

  private retry = () => this.setState({ error: null, failed: false });

  render() {
    const { id, record, ctx, render } = this.props;
    if (this.state.failed) return <BlockError id={id} error={this.state.error} onRetry={this.retry} />;
    return <HookOutput render={render} record={record} ctx={ctx} />;
  }
}

const bodyOverview: KindRender = (r, ctx) => (r.body_md ? ctx.md(r.body_md) : null);

/** Обзор записи: kinds[kind].overview, а без него — тело записи через ctx.md. */
export function KindOverview({ record, ctx }: { record: KitRecord; ctx: KitCtx }) {
  const render = ctx.config.kinds[record.kind]?.overview ?? bodyOverview;
  return <KindBlock id="overview" record={record} ctx={ctx} render={render} />;
}

export interface ResolvedKindTab {
  key: string;
  title: string;
  render: KindRender;
}

/** Вкладки вида записи из конфига (без вызова хуков). Нет вида/вкладок — []. */
export function resolveKindTabs(record: KitRecord, ctx: KitCtx): ResolvedKindTab[] {
  return (ctx.config.kinds[record.kind]?.tabs ?? []).map(t => ({ key: t.key, title: t.title, render: t.render }));
}

export interface KindTabsViewProps {
  record: KitRecord;
  ctx: KitCtx;
  /** Выбранная вкладка — управляемо: состояние живёт в URL у экрана. */
  value: string;
  onChange: (key: string) => void;
  /** aria-label группы вкладок. */
  label: string;
}

/** Вкладки вида записи: панель выбранной рендерит её хук в своём KindBlock. */
export function KindTabsView({ record, ctx, value, onChange, label }: KindTabsViewProps) {
  const tabs = resolveKindTabs(record, ctx);
  if (tabs.length === 0) return null;
  const current = tabs.find(t => t.key === value) ?? tabs[0];
  return (
    <Tabs items={tabs.map(t => ({ id: t.key, label: t.title }))} value={current.key} onChange={onChange} label={label}>
      <KindBlock key={`${record.id}:${current.key}`} id={current.key} record={record} ctx={ctx} render={current.render} />
    </Tabs>
  );
}
