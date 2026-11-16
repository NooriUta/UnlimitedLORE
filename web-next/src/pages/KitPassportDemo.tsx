// Витрина /kit: паспорт записи из документа ЧУЖОГО приложения (SPRINT_UXR_S14_KIT5/
// K5-PASSPORT-FROM-MODEL, шаг 7 — «паспорт с составом на чужих данных; он же образец для методики
// SPEC-LORE-MODEL-PASSPORT-METHOD»). Тропа «Дата-странников»: свитки — часть записи (composition),
// сны — связь-свойство, квизы — ассоциация со свойствами ребра (место на тропе, сторона —
// K5-EDGE-PROPS-COLUMNS: квиз Q-1 стоит на тропе дважды, строки различаются значениями ребра). Ни строчки рендера: документ → passportFromDoc →
// RecordScreen + RecordReader. Всё, что приложение делает само, — даёт документ и словарь статусов.
import { useMemo, useState } from 'react';
import { RecordReader, RecordScreen, passportFromDoc, type KitConfig, type KitCtx, type KitLang, type KitRecordDoc } from '@seidr/kit';

const DOC: KitRecordDoc = {
  contract: 'dw.record/1',
  record: { type: 'trail', id: 'TR-1', title: 'Время — Непрерывность', status: 'open', version: 'v1', updated_at: '2026-11-15T20:00:00Z', updated_by: null },
  schema: {
    type: 'trail', label: 'Тропа', icon: 'path-distance',
    fields: [
      { key: 'title', label: 'Название', kind: 'text', required: true, editable: false, group: 'head' },
      { key: 'body_md', label: 'Описание', kind: 'md', required: false, editable: false, group: 'body' },
      { key: 'frozen', label: 'Перегон замёрз', kind: 'bool', required: false, editable: false, group: 'props' },
      { key: 'length', label: 'Длина, шагов', kind: 'number', required: false, editable: false, group: 'props' },
      { key: 'rules', label: 'Правила перегона', kind: 'text', required: false, editable: false, group: 'props' },
    ],
    tabs: [],
    relations: [
      { key: 'scrolls', label: 'Свитки', relation: 'composition', rel: 'ON_TRAIL', dir: 'in', count: 3, place: 'part', target_type: 'scroll' },
      { key: 'dreams', label: 'Сны', relation: 'attribute', rel: 'IN_DREAM', dir: 'out', count: 2, place: 'prop', target_type: 'dream' },
      { key: 'quizzes', label: 'Квизы', relation: 'association', rel: 'QUIZ_OF', dir: 'in', count: 3, target_type: 'quiz',
        props: [{ key: 't', label: 'Место на тропе' }, { key: 'side', label: 'Сторона' }] },
    ],
  },
  values: { title: 'Время — Непрерывность', body_md: 'Тропа через два сна: у сна А — свитки времени, на стыке — квизы.', frozen: true, length: 7, dreams: ['D-A', 'D-B'] },
  links: [
    { rel: 'QUIZ_OF', dir: 'in', id: 'Q-1', type: 'quiz', title: 'Квиз о времени', status: 'open', values: { t: 0.15, side: 'A' } },
    { rel: 'QUIZ_OF', dir: 'in', id: 'Q-1', type: 'quiz', title: 'Квиз о времени', status: 'open', values: { t: 0.75, side: 'B' } },
    { rel: 'QUIZ_OF', dir: 'in', id: 'Q-2', type: 'quiz', title: 'Квиз о непрерывности', status: 'done', values: { t: 0.5, side: 'A' } },
  ],
  parts: [{
    key: 'scrolls', label: 'Свитки', type: 'scroll', rel: 'ON_TRAIL', dir: 'in', state: 'ok', count: 3,
    items: [{ id: 'S-1', title: 'Свиток I', status: 'open' }, { id: 'S-2', title: 'Свиток II', status: 'done' }],
  }],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-16T00:00:00Z', facade: 'server', sources: [{ block: 'record', state: 'ok' }] },
};

const STATUSES = [
  { code: 'open', title: 'Открыто', category: 'in_progress' as const, icon: 'progression', color: 'var(--acc)' },
  { code: 'done', title: 'Пройдено', category: 'done' as const, icon: 'check-mark', color: 'var(--suc)' },
];

export function KitPassportDemo({ lang }: { lang: KitLang }) {
  const [tab, setTab] = useState('');
  const ctx = useMemo<KitCtx>(() => {
    const p = passportFromDoc(DOC, { lang });
    const config: KitConfig = {
      modules: [], menu: { groups: [] },
      kinds: { ...p.kinds, scroll: { title: 'Свиток', icon: 'scroll-unfurled' }, quiz: { title: 'Квиз', icon: 'checkbox-tree' }, dream: { title: 'Сон', icon: 'night-sleep' } },
      statuses: { items: STATUSES },
      roles: { reader: p.reader },
    };
    // Записи образца никуда не ведут — ссылка на сам раздел витрины (сторож S4-13: «#код» вместо адреса нельзя).
    return { config, data: p.data, href: () => "#kit-passport", esc: s => s, md: s => <p>{s}</p> };
  }, [lang]);
  const record = ctx.data.records[0];
  return (
    <div data-testid="kit-passport-demo">
      <RecordScreen bar={{}} state={{ kind: 'ready' }}>
        <RecordReader record={record} ctx={ctx} tab={tab} onTab={setTab} asideOpen={false} onAside={() => {}} placement="right" />
      </RecordScreen>
    </div>
  );
}
