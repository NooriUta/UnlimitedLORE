import { Fragment, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LoreComponent, LoreTechRow } from '../../api/lore';
import { areaColor } from './LoreComponentList';
import { GameIcon } from './GameIcon';
import { isStale } from './LoreTechRegistry';

// Матрица показывает ПЕРЕСЕЧЕНИЕ компонентов и технологий — то, чего не видно
// в списочном виде: одна технология в разных компонентах разных версий
// (React 19.2.7 у четырёх, ArcadeDB 26.7.2 у восьми). Данные те же самые,
// что уже загружены реестром, — ни одного дополнительного запроса.

/** Ячейка матрицы. present=false — технология у компонента не зарегистрирована. */
export interface MatrixCell {
  tech: string;
  version: string | null;
  /** checked_at старше порога — версия есть, но ей нельзя верить. */
  stale: boolean;
  present: boolean;
}

/**
 * Строка матрицы для одного компонента.
 *
 * Чистая функция — вся логика «что показать в ячейке» тестируется без React.
 * Дубли (одна технология дважды у одного компонента) схлопываются в первую
 * запись: реестр их не запрещает, а матрица обязана показать одно значение.
 */
export function buildRow(techRows: LoreTechRow[], techs: string[]): MatrixCell[] {
  const byName = new Map<string, LoreTechRow>();
  for (const r of techRows) {
    if (r.tech_name && !byName.has(r.tech_name)) byName.set(r.tech_name, r);
  }
  return techs.map(tech => {
    const r = byName.get(tech);
    return r
      ? { tech, version: r.version, stale: isStale(r.checked_at), present: true }
      : { tech, version: null, stale: false, present: false };
  });
}

/**
 * Технологии, встречающиеся минимум в `min` компонентах.
 *
 * Зачем: колонок больше полусотни, и почти половина из них — единичные
 * зависимости одного компонента. В матрице они дают длинный хвост пустых
 * клеток и прячут то, ради чего её открывают, — общие технологии.
 */
export function sharedTechs(techs: string[], counts: Record<string, number>, min = 2): string[] {
  return techs.filter(t => (counts[t] ?? 0) >= min);
}

const S = {
  wrap: { overflowX: 'auto' as const, width: '100%', border: '1px solid var(--bd)', borderRadius: 8, background: 'var(--bg1)' },
  table: { borderCollapse: 'separate' as const, borderSpacing: 0, fontSize: 'var(--fs-base)' },
  // Первая колонка залипает: при 50+ колонках без неё непонятно, чья это строка.
  stickyHead: {
    position: 'sticky' as const, left: 0, zIndex: 3, background: 'var(--bg2)',
    borderRight: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)',
    padding: '6px 10px', textAlign: 'left' as const, minWidth: 190,
  },
  techHead: {
    // Вертикальные подписи — иначе полсотни колонок растягивают таблицу
    // на несколько экранов и матрица перестаёт читаться как матрица.
    writingMode: 'vertical-rl' as const, transform: 'rotate(180deg)',
    whiteSpace: 'nowrap' as const, padding: '8px 3px', verticalAlign: 'bottom' as const,
    background: 'var(--bg2)', borderBottom: '1px solid var(--bd)',
    fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--t2)',
    maxHeight: 150, position: 'sticky' as const, top: 0, zIndex: 2,
  },
  areaRow: {
    position: 'sticky' as const, left: 0, zIndex: 3, background: 'var(--bg3)',
    padding: '5px 10px', fontSize: 'var(--fs-xs)', fontWeight: 700,
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
    borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)',
  },
  compCell: {
    position: 'sticky' as const, left: 0, zIndex: 1, background: 'var(--bg1)',
    borderRight: '1px solid var(--bd)', borderTop: '1px solid var(--bd)',
    padding: '4px 10px', whiteSpace: 'nowrap' as const,
  },
  cell: {
    borderTop: '1px solid var(--bd)', borderLeft: '1px solid color-mix(in srgb, var(--bd) 45%, transparent)',
    padding: '3px 5px', textAlign: 'center' as const, fontFamily: 'var(--mono)',
    fontSize: 'var(--fs-2xs)', cursor: 'pointer', minWidth: 34,
  },
  legend: { display: 'flex', gap: 14, flexWrap: 'wrap' as const, alignItems: 'center', margin: '10px 2px 0', fontSize: 'var(--fs-xs)', color: 'var(--t3)' },
  toggle: {
    fontSize: 'var(--fs-xs)', padding: '3px 10px', borderRadius: 5, cursor: 'pointer',
    border: '1px solid var(--b3)', background: 'transparent', color: 'var(--t2)', font: 'inherit',
  },
};

export default function LoreTechMatrix({ byArea, rowsByComponent, allTech, techCounts, onPick }: {
  byArea: [string, LoreComponent[]][];
  rowsByComponent: Map<string, LoreTechRow[]>;
  allTech: string[];
  techCounts: Record<string, number>;
  /** Клик по ячейке — правка в списочном виде; технология предзаполняется. */
  onPick: (componentId: string, techName: string) => void;
}) {
  const { t } = useTranslation();
  const [sharedOnly, setSharedOnly] = useState(false);

  const techs = useMemo(
    () => (sharedOnly ? sharedTechs(allTech, techCounts) : allTech),
    [sharedOnly, allTech, techCounts]);

  const sharedCount = useMemo(() => sharedTechs(allTech, techCounts).length, [allTech, techCounts]);

  if (allTech.length === 0) {
    return <div style={{ padding: 24, color: 'var(--t3)' }}>{t('lore.techMatrix.empty', 'Технологии не зарегистрированы.')}</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' as const }}>
        <button
          style={{ ...S.toggle, ...(sharedOnly ? { borderColor: 'var(--acc)', color: 'var(--acc)' } : {}) }}
          onClick={() => setSharedOnly(v => !v)}
        >
          {sharedOnly
            ? t('lore.techMatrix.showAll', 'Показать все ({{n}})', { n: allTech.length })
            : t('lore.techMatrix.sharedOnly', 'Только общие ({{n}})', { n: sharedCount })}
        </button>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--t3)' }}>
          {t('lore.techMatrix.counts', '{{c}} компонентов · {{t}} технологий', {
            c: byArea.reduce((n, [, cs]) => n + cs.length, 0), t: techs.length,
          })}
        </span>
      </div>

      <div style={S.wrap}>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.stickyHead}>{t('lore.techMatrix.component', 'Компонент')}</th>
              {techs.map(tn => (
                <th key={tn} style={S.techHead} title={t('lore.techMatrix.usedBy', 'Компонентов: {{n}}', { n: techCounts[tn] ?? 0 })}>
                  {tn}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {byArea.map(([area, comps]) => (
              <Fragment key={area}>
                <tr>
                  <td style={{ ...S.areaRow, color: areaColor(area) }}>{area}</td>
                  <td colSpan={techs.length} style={{ background: 'var(--bg3)', borderTop: '1px solid var(--bd)', borderBottom: '1px solid var(--bd)' }} />
                </tr>
                {comps.map(c => {
                  const cells = buildRow(rowsByComponent.get(c.component_id) ?? [], techs);
                  return (
                    <tr key={c.component_id}>
                      <td style={S.compCell}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <GameIcon slug={c.game_icon} size={12} style={{ color: areaColor(area) }} />
                          <span style={{ color: 'var(--t1)', fontSize: 'var(--fs-sm)' }}>{c.full_name ?? c.component_id}</span>
                        </span>
                      </td>
                      {cells.map(cell => (
                        <td
                          key={cell.tech}
                          style={{
                            ...S.cell,
                            color: !cell.present ? 'var(--t4)' : cell.stale ? 'var(--wrn)' : 'var(--t2)',
                            background: cell.present
                              ? (cell.stale
                                  ? 'color-mix(in srgb, var(--wrn) 10%, transparent)'
                                  : 'color-mix(in srgb, var(--acc) 8%, transparent)')
                              : 'transparent',
                          }}
                          title={
                            cell.present
                              ? `${c.component_id} · ${cell.tech} ${cell.version ?? ''}`
                                + (cell.stale ? ' — ' + t('lore.techMatrix.staleHint', 'давно не проверялось') : '')
                              : t('lore.techMatrix.addHint', 'Добавить {{tech}} компоненту {{comp}}', { tech: cell.tech, comp: c.component_id })
                          }
                          onClick={() => onPick(c.component_id, cell.tech)}
                        >
                          {cell.present ? (cell.version ?? '✓') : ''}
                          {cell.stale && ' ⚠'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div style={S.legend}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'color-mix(in srgb, var(--acc) 25%, transparent)', border: '1px solid var(--bd)', marginRight: 5 }} />
          {t('lore.techMatrix.legendOk', 'версия актуальна')}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'color-mix(in srgb, var(--wrn) 25%, transparent)', border: '1px solid var(--bd)', marginRight: 5 }} />
          {t('lore.techMatrix.legendStale', 'давно не проверялось')}</span>
        <span>{t('lore.techMatrix.legendEmpty', 'пусто — технология не зарегистрирована у компонента')}</span>
      </div>
    </div>
  );
}
