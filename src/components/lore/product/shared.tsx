// Общие примитивы продуктового слоя (ADR-LORE-022/032, Остервальдер + Коберн).
// Единый стиль паспортов/списков как в прототипе forseti-storyline-vp.html,
// на реальных токенах темы. Данные — через fetchLoreSlice (идиома LoreReleasesBoard).
import { useEffect, useState, type ReactNode, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchLoreSlice } from '../../../api/lore';
import { marked } from '../markdown';
import { sanitizeMd } from '../sanitizeHtml';

// Навигация между продуктовыми разделами (section = ?section=, id = ?passport=).
export type ProductNavigate = (section: string, id?: string) => void;
export interface ProductScreenProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNavigate: ProductNavigate;
  onError: (e: unknown) => void;
  listSearch?: string;
  /** Записать значение локального поиска (то же `?q=`, поле переехало в панель). */
  onListSearch?: (v: string) => void;
  /**
   * PL-16: какой сценарий раскрыт до задач (`?uc=`).
   *
   * Живёт в URL, а не в состоянии компонента, потому что раскрытый узел — это
   * то, чем делятся: «смотри, эта US не двигается». Держи мы его локально,
   * ссылка приводила бы на свёрнутое дерево, и получатель искал бы строку
   * заново — то есть ссылка молча теряла бы ровно то, ради чего её послали.
   */
  expandedUc?: string | null;
  onExpandUc?: (id: string | null) => void;
}

// Цвет по префиксу id — как typeColor() прототипа, на семантических токенах.
export function productColor(id: string): string {
  if (id.startsWith('JOB-')) return 'var(--job)';
  if (id.startsWith('PAIN-')) return 'var(--pain)';
  if (id.startsWith('GAIN-')) return 'var(--gain)';
  if (id.startsWith('FEAT-')) return 'var(--g-value)';
  if (id.startsWith('US-') || id.startsWith('UC-')) return 'var(--g-do)';
  if (id.startsWith('ACT-')) return 'var(--wrn)';
  if (id.startsWith('ADR-')) return 'var(--g-know)';
  return 'var(--acc)';
}

// Хук слайса: fetchLoreSlice + loading + AbortController + проброс ошибок наверх.
export function useSlice<T>(
  slice: string,
  params: Record<string, string> | undefined,
  onError: (e: unknown) => void,
  deps: unknown[] = [],
): { rows: T[]; loading: boolean } {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    fetchLoreSlice<T>(slice, params, ctrl.signal)
      .then(r => { setRows(r); setLoading(false); })
      .catch(e => { if (!ctrl.signal.aborted) { onError(e); setLoading(false); } });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { rows, loading };
}

const arr = (x: string[] | null | undefined): string[] => Array.isArray(x) ? x : [];
export { arr as asArray };

// ── презентационные примитивы (совпадают с прототипом: pill/psec/trow/lnk) ──
export function Pill({ children, tone, style }: { children: ReactNode; tone?: 'ok' | 'act' | 'warn' | 'muted'; style?: CSSProperties }) {
  const c = tone === 'ok' ? 'var(--suc)' : tone === 'act' ? 'var(--inf)' : tone === 'warn' ? 'var(--wrn)' : 'var(--t2)';
  return <span style={{ fontSize: 'var(--fs-xs)', fontFamily: 'var(--mono)', border: `1px solid ${c}`, borderRadius: 999, padding: '1px 7px', color: c, whiteSpace: 'nowrap', ...style }}>{children}</span>;
}

export function PSection({ title, children, style }: { title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ border: '1px solid var(--bd)', borderRadius: 6, background: 'var(--bg1)', padding: '8px 11px', marginTop: 8, ...style }}>
      <div style={{ fontSize: 'var(--fs-xs)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--t3)', marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  );
}

export function TRow({ children, first }: { children: ReactNode; first?: boolean }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 'var(--fs-base)', color: 'var(--t2)', borderTop: first ? 'none' : '1px solid color-mix(in srgb,var(--bd) 40%,transparent)' }}>{children}</div>;
}

export function LinkChip({ children, color, onClick, dim, title }: { children: ReactNode; color?: string; onClick?: () => void; dim?: boolean; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} disabled={!onClick}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)', border: '1px solid var(--bd)', borderRadius: 5, padding: '1px 6px', margin: '2px 3px 2px 0', background: 'var(--bg2)', color: color ?? 'var(--t2)', cursor: onClick ? 'pointer' : 'default', textDecoration: onClick ? 'underline dotted' : 'none', opacity: dim ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

// ── master-detail на весь контент-пейн (список слева + карточка справа) ──
export function MasterDetail({ list, detail }: { list: ReactNode; detail: ReactNode }) {
  return (
    <div style={{ display: 'flex', minHeight: 380, background: 'var(--bg0)', flex: 1 }}>
      <div style={{ width: 288, flexShrink: 0, borderRight: '1px solid var(--bd)', background: 'var(--bg1)', overflow: 'auto', maxHeight: 'calc(100vh - 200px)' }}>{list}</div>
      <div style={{ flex: 1, minWidth: 0, padding: 14, overflow: 'auto', maxHeight: 'calc(100vh - 200px)' }}>{detail}</div>
    </div>
  );
}

export function ListRow({ id, title, meta, selected, onClick }: { id: string; title: string | null; meta?: ReactNode; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', background: selected ? 'var(--bg2)' : 'transparent', padding: selected ? '7px 11px 7px 8px' : '7px 11px', cursor: 'pointer', borderBottom: '1px solid color-mix(in srgb,var(--bd) 45%,transparent)', borderLeft: selected ? `3px solid ${productColor(id)}` : 'none', fontSize: 12.5, color: selected ? 'var(--t1)' : 'var(--t2)', fontWeight: selected ? 600 : 400 }}>
      <span style={{ fontFamily: 'var(--mono)', fontSize: 9.5, display: 'block', color: productColor(id) }}>{id}</span>
      {title}
      {meta && <span style={{ marginLeft: 6 }}>{meta}</span>}
    </button>
  );
}

/**
 * Тело в markdown — РЕНДЕРОМ, а не сырым текстом.
 *
 * Паспорта US и корня показывали `scenario_md`/`acceptance_md` в `<pre>`: на
 * экране висели «### Триггер» и «1.» вместо заголовков и списка. Тело пишется
 * в markdown-редакторе и по всему корпусу читается отрендеренным — здесь оно
 * оставалось единственным местом, где разметка видна как разметка.
 *
 * `marked` берём из общего модуля (там же его конфиг), санитайзер обязателен:
 * тело приходит из корпуса и может содержать HTML.
 */
export function Markdown({ md, style }: { md: string | null | undefined; style?: CSSProperties }) {
  const text = (md ?? '').trim();
  if (!text) return null;
  const html = sanitizeMd(marked.parse(text) as string);
  return (
    <div
      className="lore-md"
      style={{ fontSize: 'var(--fs-base)', color: 'var(--t2)', ...style }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Локальный поиск по списку — ТОТ ЖЕ вид, что у списка спринтов (лупа слева,
 * крестик очистки справа), и то же место: ВНУТРИ панели списка.
 *
 * Раньше продуктовые экраны искали через общий бар над навигацией. Разница не
 * косметическая: поле в общем баре выглядит фильтром ЭКРАНА, поле в панели —
 * фильтром СПИСКА, а фильтруется именно список. Владелец на приёмке: «локальный
 * поиск сделай как в спринтах».
 *
 * Значение по-прежнему живёт в `?q=` — это одно поле, переехавшее на своё
 * место, а не второй поиск рядом с первым.
 */
export function ListSearch({ value, onChange, placeholder }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 9px',
      borderBottom: '1px solid var(--bd)', background: 'var(--bg1)',
    }}>
      <span style={{ color: 'var(--t3)', fontSize: 'var(--fs-base)', flexShrink: 0 }}>🔍</span>
      <input
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          color: 'var(--t1)', fontSize: 'var(--fs-sm)', fontFamily: 'var(--mono)',
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      {value && (
        <span
          onClick={() => onChange('')}
          style={{ color: 'var(--t3)', cursor: 'pointer', fontSize: 'var(--fs-sm)', flexShrink: 0 }}
        >
          ✕
        </span>
      )}
    </div>
  );
}

/**
 * Полоса фильтр-чипов над списком продуктового экрана (PL-18).
 *
 * Вынесена из `LoreVpRegistry`, где жила инлайном: реестр акторов просит ровно
 * такую же полосу, и копия стала бы вторым набором размеров и цветов, которые
 * разъезжаются при первой же правке одного из них. Список значений задаёт
 * вызывающий — общего у экранов оформление, а не словарь.
 */
export function FilterChips<K extends string>({
  options, value, onChange,
}: {
  options: { key: K; label: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '8px 9px', borderBottom: '1px solid var(--bd)', background: 'var(--bg1)' }}>
      {options.map(o => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-pressed={active}
            style={{
              fontSize: 10.5,
              fontFamily: 'var(--mono)',
              borderRadius: 999,
              padding: '2px 9px',
              cursor: 'pointer',
              background: active ? 'var(--bg3)' : 'transparent',
              border: `1px solid ${active ? 'var(--bdh)' : 'var(--bd)'}`,
              color: active ? 'var(--t1)' : 'var(--t2)',
              fontWeight: active ? 600 : 400,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function PassportHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 4 }}>
      <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
      {children}
    </div>
  );
}

export function EmptyDetail({ text }: { text?: string }) {
  // Дефолт разрешается ВНУТРИ компонента, а не в сигнатуре: значение по умолчанию
  // в параметрах вычисляется до вызова хука и локализовать его там нечем.
  const { t } = useTranslation();
  return (
    <div style={{ padding: 24, textAlign: 'center', color: 'var(--t3)', fontSize: 'var(--fs-base)' }}>
      {text ?? t('lore.product.pickItem', 'Выберите элемент слева')}
    </div>
  );
}
