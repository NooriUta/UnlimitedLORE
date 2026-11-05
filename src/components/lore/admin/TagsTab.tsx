import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TagRow } from './types';
import { S } from './adminStyles';
import { Toolbar } from './adminWidgets';

// ── Теги (AL-40: поиск/сортировка по 93 строкам) ────────────────────────────
export function TagsTab({ know }: { know: TagRow[] }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'uses' | 'alpha'>('uses');
  const list = (title: string, rows: TagRow[]) => {
    const shown = rows
      .filter(r => !q || r.tag_id.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => sort === 'uses' ? b.uses - a.uses : a.tag_id.localeCompare(b.tag_id));
    return (
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
          {title} · {shown.length}/{rows.length}
        </div>
        <div style={S.tw}>
          <table style={S.table}>
            <thead><tr><th style={S.th}>тег</th><th style={S.th}>использований</th></tr></thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.tag_id} style={r.uses === 0 ? { opacity: 0.55 } : undefined}>
                  <td style={{ ...S.td, fontFamily: 'var(--mono)' }}>{r.tag_id}</td>
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
      <div style={S.card}>{t('lore.admin.tagsNote', 'Read-only (D6): слияние/переименование через MCP-инструменты, отдельного UI-редактора нет.')}</div>
      <Toolbar q={q} setQ={setQ}
        shown={know.filter(r => !q || r.tag_id.includes(q.toLowerCase())).length}
        total={know.length}
        seg={{ options: [['uses', t('lore.admin.byUses', 'По использованию')], ['alpha', t('lore.admin.byAlpha', 'По алфавиту')]], value: sort, set: v => setSort(v as 'uses' | 'alpha') }} />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {list('KnowTag', know)}
      </div>
    </div>
  );
}
