import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { type KcState } from '../kc-state';
import type { Preflight } from './types';
import { S } from './adminStyles';
import { GameIcon } from '../GameIcon';
import { actBtn, searchBox } from '../adminLayout';
import { useIsNarrow } from './useIsNarrow';
import { cardParts, type Col } from './adminCards';

// AL-31: разбор исходов KC-моста — в kc-state.ts (чистая логика, покрыта vitest).

/** AL-31: один разбор исходов для всех KC-вкладок. */
export function KcStateView({ s, empty }: { s: KcState<unknown>; empty: ReactNode }) {
  const { t } = useTranslation();
  if (s.k === 'loading') return <div style={S.state('neutral')}>{t('lore.admin.kcLoading', 'Спрашиваем Keycloak…')}</div>;
  if (s.k === 'forbidden') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcForbiddenH', 'Нет прав смотреть этот список')}</div>
      <div>{t('lore.admin.kcForbiddenB', 'Управление доступом открыто только роли admin. Это НЕ пустой список: записи могут существовать, но они вам не видны.')}</div>
      <code style={S.stateCode}>403 · admin role required</code>
    </div>
  );
  if (s.k === 'off') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcOffH', 'Keycloak не подключён')}</div>
      <div>{t('lore.admin.kcOffB', 'Мост в KC не настроен, получить список неоткуда. Это не значит, что записей нет — их состояние сейчас неизвестно. Настройка: KC_ADMIN_CLIENT_SECRET в .env, см. RUNBOOK-ADMIN-LORE. Остальной LORE работает как обычно.')}</div>
      <code style={S.stateCode}>503 · {s.detail}</code>
    </div>
  );
  if (s.k === 'error') return (
    <div style={S.state('bad')}>
      <div style={S.stateH('bad')}>{t('lore.admin.kcErrH', 'Keycloak не ответил')}</div>
      <div>{t('lore.admin.kcErrB', 'Запрос не дошёл или сорвался. Состояние записей неизвестно — это не пустой список.')}</div>
      <code style={S.stateCode}>{s.detail}</code>
    </div>
  );
  return s.rows.length ? null : <>{empty}</>;
}

// AL-33/AL-63: экран не имеет права утверждать наличие защиты, которой нет.
//
// Плашка НЕ УДАЛЕНА вместе с включением AL-17, а привязана к факту — к тому же
// `agent_scope_enforced`, что показывает чек-лист в «Настройках». Удаление
// вернуло бы исходную проблему зеркально: экран молча утверждал бы защиту,
// которой может не быть (auth выключили флагом, откатили образ, поднялись без
// KC). Теперь утверждение всегда соответствует состоянию бэкенда.
//
// preflight === null — состояние НЕИЗВЕСТНО (запрос не дошёл), и это не то же
// самое, что «защита есть»: показываем предупреждение. Умолчание в пользу
// недоверия здесь дешевле ошибки в другую сторону.
export function NotEnforcedNotice({ pf }: { pf: Preflight | null }) {
  const { t } = useTranslation();
  if (pf?.agent_scope_enforced) return null;
  const unknown = pf === null;
  return (
    <div style={{ ...S.warn, color: 'var(--dng)', borderColor: 'color-mix(in srgb, var(--dng) 40%, transparent)', background: 'color-mix(in srgb, var(--dng) 8%, transparent)' }}>
      <b>{unknown
        ? t('lore.admin.notEnforcedUnkH', 'Проверяются ли эти права — сейчас неизвестно.')
        : t('lore.admin.notEnforcedH', 'Права из этой таблицы не проверяются.')}</b>{' '}
      {unknown
        ? t('lore.admin.notEnforcedUnkB', 'Бэкенд не ответил на auth-preflight, поэтому состояние защиты не подтверждено. Считайте таблицу описанием намерения, пока не восстановится связь.')
        : t('lore.admin.notEnforcedB', 'Клейм agent_scope бэкенд не читает: сейчас это фильтр видимости инструментов, не защита. Включается флагом LORE_AUTH_ENABLED — состояние видно в «Настройках».')}
    </div>
  );
}

/**
 * AL-40: единый тулбар таблиц — поиск + «показано N из M» + опциональный сегмент-фильтр.
 * SH-13: у поиска иконка лупы; на телефоне поле во всю ширину, 40px и шрифт 16px (iOS не зумит).
 */
export function Toolbar({ q, setQ, shown, total, seg, placeholder }: {
  q: string; setQ: (v: string) => void; shown: number; total: number;
  seg?: { options: [string, string][]; value: string; set: (v: string) => void };
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const narrow = useIsNarrow();
  const sb = searchBox(narrow);
  const ph = placeholder ?? t('lore.admin.search', 'Поиск…');
  return (
    <div style={S.toolbar}>
      <label style={sb.wrap}>
        <GameIcon slug="magnifying-glass" size={13} style={{ color: 'var(--t3)', flexShrink: 0 }} />
        <input style={sb.input} type="search" placeholder={ph} aria-label={ph} value={q} onChange={e => setQ(e.target.value)} />
      </label>
      <span style={S.count}>{t('lore.admin.shownOf', 'показано {{n}} из {{m}}', { n: shown, m: total })}</span>
      {seg && (
        <span style={S.seg}>
          {seg.options.map(([v, l]) => (
            <button key={v} style={{ ...S.segBtn(seg.value === v), minHeight: narrow ? 40 : undefined }} aria-pressed={seg.value === v} onClick={() => seg.set(v)}>{l}</button>
          ))}
        </span>
      )}
    </div>
  );
}

/** Подзаголовок секции вкладки (прототип .sec): подпись · число · пояснение. */
export function Sec({ children, n, hint, first }: { children: ReactNode; n?: number | string; hint?: ReactNode; first?: boolean }) {
  return (
    <div style={{ ...S.sec, ...(first ? { marginTop: 0 } : null) }}>
      {children}
      {n !== undefined && <span style={{ fontFamily: 'var(--mono)', letterSpacing: 0 }}>{n}</span>}
      {hint && <span style={{ textTransform: 'none', letterSpacing: 0 }}>· {hint}</span>}
    </div>
  );
}

/** Стиль кнопки действия строки: S.btn/S.primary/S.danger + тап-цель (40px телефон / 26px десктоп). */
export const rowBtn = (narrow: boolean, base: CSSProperties = S.btn): CSSProperties => ({ ...base, ...actBtn(narrow) });

/**
 * AH-05 п.2 (прототип admin-v2, .rt): одна таблица — две раскладки.
 * Десктоп — плотная таблица; телефон — карточка на строку с подписями полей,
 * действия внизу карточки во всю ширину. Раскрытие строки (expand) — под строкой
 * таблицы или внутри карточки.
 */
export function RespTable<R>({ cols, rows, rowKey, cell, narrow, rowStyle, selected, expand, ariaLabel }: {
  cols: Col[]; rows: R[]; rowKey: (r: R) => string; cell: (r: R, key: string) => ReactNode; narrow: boolean;
  rowStyle?: (r: R) => CSSProperties | undefined; selected?: (r: R) => boolean;
  expand?: (r: R) => ReactNode; ariaLabel?: string;
}) {
  if (narrow) {
    const p = cardParts(cols);
    return (
      <div role="list" aria-label={ariaLabel}>
        {rows.map(r => {
          const ex = expand?.(r);
          return (
            <div key={rowKey(r)} role="listitem" style={{ ...S.pcard(!!selected?.(r)), cursor: 'default', ...rowStyle?.(r) }}>
              {p.title && (
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 'var(--fs-md)', color: 'var(--t1)', paddingBottom: 4, overflowWrap: 'anywhere' }}>
                  {cell(r, p.title.key)}
                </div>
              )}
              {p.body.map(c => c.kind === 'full' ? (
                <div key={c.key} style={{ padding: '3px 0', fontSize: 'var(--fs-sm)', color: 'var(--t2)', minWidth: 0, overflowWrap: 'anywhere' }}>
                  {c.label && <div style={{ ...S.pcardL, marginBottom: 2 }}>{c.label}</div>}
                  {cell(r, c.key)}
                </div>
              ) : (
                <div key={c.key} style={S.pcardRow}>
                  <span style={S.pcardL}>{c.label}</span>
                  <span style={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right', fontFamily: c.num ? 'var(--mono)' : undefined }}>{cell(r, c.key)}</span>
                </div>
              ))}
              {p.act.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 8, marginTop: 6, borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>
                  {p.act.map(c => <Fragment key={c.key}>{cell(r, c.key)}</Fragment>)}
                </div>
              )}
              {ex && <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--bd)' }}>{ex}</div>}
            </div>
          );
        })}
      </div>
    );
  }
  const tdOf = (c: Col): CSSProperties => ({
    ...S.td,
    ...(c.kind === 'title' ? { fontFamily: 'var(--mono)', color: 'var(--t1)' } : null),
    ...(c.num ? S.num : null),
    ...(c.kind === 'act' ? { whiteSpace: 'nowrap', textAlign: 'right' } : null),
  });
  return (
    <div style={S.twBox}>
      <table style={S.table} aria-label={ariaLabel}>
        <thead><tr>{cols.map(c => <th key={c.key} style={{ ...S.th, cursor: 'default', ...(c.num ? { textAlign: 'right' } : null) }}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map(r => {
            const sel = !!selected?.(r);
            const ex = expand?.(r);
            return (
              <Fragment key={rowKey(r)}>
                <tr style={rowStyle?.(r)} aria-selected={selected ? sel : undefined}>
                  {cols.map((c, i) => (
                    <td key={c.key} style={{ ...tdOf(c), ...(sel ? S.rowSel : null), ...(sel && i === 0 ? S.rowSelFirst : null) }}>
                      {c.kind === 'act' ? <span style={{ display: 'inline-flex', gap: 4 }}>{cell(r, c.key)}</span> : cell(r, c.key)}
                    </td>
                  ))}
                </tr>
                {ex && <tr><td colSpan={cols.length} style={{ ...S.td, background: 'var(--bg2)', padding: '10px 12px' }}>{ex}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
