import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagRow } from './types';
import { S } from './adminStyles';
import { Toolbar } from './adminWidgets';

// ── Теги (AL-40: поиск/сортировка по 93 строкам) ────────────────────────────
// AH-05 п.2: две колонки помещаются и на телефоне — таблица остаётся таблицей,
// со своим контейнером прокрутки (панель целиком вбок не листается).
export function TagsTab({ know }: { know: TagRow[] }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'uses' | 'alpha'>('uses');
  const ql = q.toLowerCase();
  // T-02: один фильтр на список и на счётчик — раньше счётчик не приводил tag_id к нижнему регистру.
  const match = (r: TagRow) => !ql || r.tag_id.toLowerCase().includes(ql);
  const list = (title: string, rows: TagRow[]) => {
    const shown = rows
      .filter(match)
      .sort((a, b) => sort === 'uses' ? b.uses - a.uses : a.tag_id.localeCompare(b.tag_id));
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...S.sec, marginTop: 0 }}>
          {title} <span style={{ fontFamily: 'var(--mono)', letterSpacing: 0 }}>{shown.length}/{rows.length}</span>
        </div>
        <div style={S.twBox}>
          <table style={S.table}>
            <thead><tr>
              <th style={{ ...S.th, cursor: 'default' }}>{t('lore.admin.thTag', 'тег')}</th>
              <th style={{ ...S.th, cursor: 'default', textAlign: 'right' }}>{t('lore.admin.thUses', 'использований')}</th>
            </tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.tag_id} style={r.uses === 0 ? { opacity: 0.55 } : undefined}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)', overflowWrap: 'anywhere' }}>{r.tag_id}</td>
                  <td style={{ ...S.td, ...S.num }}>
                    {r.uses}{r.uses === 0 && <span style={{ color: 'var(--t3)', fontFamily: 'inherit' }}> · {t('lore.admin.tagOrphan', 'кандидат на удаление')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  return (
    <div>
      <div style={S.note}>{t('lore.admin.tagsNote', 'Read-only (D6): слияние/переименование через MCP-инструменты, отдельного UI-редактора нет.')}</div>
      <Toolbar q={q} setQ={setQ}
        shown={know.filter(match).length}
        total={know.length}
        placeholder={t('lore.admin.tagSearch', 'тег…')}
        seg={{ options: [['uses', t('lore.admin.byUses', 'По использованию')], ['alpha', t('lore.admin.byAlpha', 'По алфавиту')]], value: sort, set: v => setSort(v as 'uses' | 'alpha') }} />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {list('KnowTag', know)}
      </div>
    </div>
  );
}
