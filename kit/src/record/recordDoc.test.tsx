// @vitest-environment jsdom
// passportFromDoc — сборщик паспорта в kit (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 3).
//
// Документ здесь — ЧУЖОЙ, не LORE: тропа «Дата-странников» со свитками (часть), снами (связь-
// свойство) и квизами (ассоциация). Сборщик не знает ни одного предметного имени; всё, что он
// делает, — раскладывает документ по местам, которые документ назвал, и честно говорит о пробелах.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx } from '../core/contract';
import { KitLangProvider } from '../i18n';
import { bodyMdIsOwnSection, passportFromDoc, type KitRecordDoc } from './recordDoc';

const doc = (over: Partial<KitRecordDoc> = {}): KitRecordDoc => ({
  contract: 'dw.record/1',
  record: { type: 'trail', id: 'TR-1', title: 'Время — Непрерывность', status: 'open', version: 'v1', updated_at: null, updated_by: null },
  schema: {
    type: 'trail', label: 'Тропа', icon: 'path-distance',
    fields: [
      { key: 'title', label: 'Название', kind: 'text', required: true, editable: true, group: 'head' },
      { key: 'body_md', label: 'Описание', kind: 'md', required: false, editable: true, group: 'body' },
      { key: 'frozen', label: 'Перегон замёрз', kind: 'bool', required: false, editable: true, group: 'props', write: { to: 'trail.frozen' } },
      { key: 'length', label: 'Длина', kind: 'number', required: true, editable: true, group: 'props' },
    ],
    tabs: [{ key: 'quizzes', label: 'Квизы', zone: 'record', rel: 'QUIZ_OF', dir: 'in' }],
    relations: [
      { key: 'scrolls', label: 'Свитки', relation: 'composition', rel: 'ON_TRAIL', dir: 'in', count: 3, place: 'part', target_type: 'scroll' },
      { key: 'dreams', label: 'Сны', relation: 'attribute', rel: 'IN_DREAM', dir: 'out', count: 1, place: 'prop', manageable: true, target_type: 'dream' },
      { key: 'quizzes', label: 'Квизы', relation: 'association', rel: 'QUIZ_OF', dir: 'in', count: 1, target_type: 'quiz' },
    ],
  },
  values: { title: 'Время — Непрерывность', body_md: 'Тропа через два сна.', frozen: true, length: 7, dreams: ['D-A'] },
  links: [{ rel: 'QUIZ_OF', dir: 'in', id: 'Q-1', type: 'quiz', title: 'Квиз о времени', status: 'open', values: { difficulty: 2 } }],
  parts: [{ key: 'scrolls', label: 'Свитки', type: 'scroll', rel: 'ON_TRAIL', dir: 'in', state: 'ok', count: 3,
    items: [{ id: 'S-1', title: 'Свиток I', status: 'open' }, { id: 'S-2', title: 'Свиток II', status: 'done' }] }],
  perms: { can_edit: true, can_status: false, can_create: false, status_next: [], reason: null },
  meta: { loaded_at: '2026-11-15T22:00:00Z', facade: 'server', sources: [{ block: 'record', state: 'ok' }] },
  ...over,
});

describe('passportFromDoc · раскладка чужого документа', () => {
  const p = passportFromDoc(doc(), { lang: 'ru' });
  const kind = p.kinds.trail;

  it('запись: заголовок и тело из values, свойства — полями', () => {
    expect(p.record).toMatchObject({ id: 'TR-1', kind: 'trail', title: 'Время — Непрерывность', body_md: 'Тропа через два сна.' });
    expect(p.record.fields.frozen).toBe(true);
  });

  it('часть (composition) — вкладкой со счётом; её элементы — записи и рёбра', () => {
    const tab = kind.tabs?.find(t => t.key === 'scrolls');
    expect(tab?.count).toBe(3);
    expect(p.data.records.map(r => r.id)).toEqual(expect.arrayContaining(['S-1', 'S-2', 'Q-1']));
    expect(p.data.edges).toContainEqual({ from: 'S-1', to: 'TR-1', type: 'ON_TRAIL', fromKind: 'scroll', toKind: 'trail' });
  });

  it('ассоциация (link_tab) — связью kit, а не второй вкладкой приложения (B13)', () => {
    expect(kind.relations?.map(r => r.key)).toEqual(['quizzes']);
    expect(kind.relations?.[0]).toMatchObject({ relation: 'association', targetKind: 'quiz' });
    expect(kind.tabs?.some(t => t.key === 'quizzes')).toBe(false);
  });

  it('связь-свойство — поле-ссылка с путём привязки и обликом вида', () => {
    expect(kind.fields?.find(f => f.key === 'dreams')).toMatchObject({ type: 'ref', relation: { rel: 'IN_DREAM', dir: 'out' }, refKind: 'dream' });
  });

  it('правимо только поле с путём записи; обязательность — блокирующая', () => {
    expect(kind.fields?.find(f => f.key === 'frozen')).toMatchObject({ type: 'bool', editable: true });
    const length = kind.fields?.find(f => f.key === 'length');
    expect(length?.editable).toBeUndefined();
    expect(length?.required).toBe('block');
  });

  it('тело — разделом данных, права — ролью читателя', () => {
    expect(kind.bodySections).toEqual([{ key: 'body_md', title: 'Описание', editable: true }]);
    expect(p.reader).toEqual({ canEdit: true, canStatus: false });
  });

  it('итог части больше пришедшего — оговорка «показаны N из M» под списком', () => {
    const ctx = { config: { modules: [], menu: { groups: [] }, kinds: p.kinds, statuses: { items: [] } }, data: p.data, href: (id: string) => '#' + id, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
    const tab = kind.tabs!.find(t => t.key === 'scrolls')!;
    render(<KitLangProvider lang="ru">{tab.render(p.record, ctx)}</KitLangProvider>);
    expect(screen.getAllByRole('status').map(x => x.textContent)).toContain('показаны 2 из 3');
  });
});

describe('passportFromDoc · честные состояния', () => {
  it('часть без прав — «нет прав», сбой — «сбой»; ни то ни другое не «пусто», счёт — null', () => {
    const p = passportFromDoc(doc({ parts: [
      { key: 'scrolls', label: 'Свитки', type: 'scroll', rel: 'ON_TRAIL', dir: 'in', state: 'denied', count: null, items: [] },
      { key: 'shadows', label: 'Тени', type: 'shadow', rel: 'HAUNTS', dir: 'in', state: 'error', error: 'срез упал', count: null, items: [] },
    ] }), { lang: 'ru' });
    const ds = (p.data.meta as { data_state?: { source: string; state: string }[] }).data_state ?? [];
    expect(ds).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'scrolls', state: 'forbidden' }),
      expect.objectContaining({ source: 'shadows', state: 'error', reason: 'срез упал' }),
    ]));
    expect(p.kinds.trail.tabs?.find(t => t.key === 'scrolls')?.count).toBeNull();
  });

  it('«обрезано» — строкой состояния, но НЕ ошибкой (иначе счётчик вкладки становится «?»)', () => {
    const p = passportFromDoc(doc({ meta: { loaded_at: '', facade: 'server', sources: [{ block: 'scrolls', state: 'truncated', total: 230 }] } }), { lang: 'ru' });
    expect(p.data.meta.errors ?? []).toEqual([]);
    expect((p.data.meta as { data_state?: unknown[] }).data_state).toContainEqual(expect.objectContaining({ source: 'scrolls', state: 'truncated', total: 230, audience: 'tech' }));
  });
});

describe('passportFromDoc · слоты приложения (K-14)', () => {
  it('колонки детей — только когда связь принесла значения', () => {
    const childColumns = (k: string) => (k === 'quiz' ? { columns: ['fields.difficulty'], kind: { title: 'Квиз', icon: 'checkbox-tree' } } : undefined);
    const p = passportFromDoc(doc(), { lang: 'ru', childColumns });
    expect(p.kinds.trail.relations?.[0].columns).toEqual(['status', 'kind', 'id', 'title', 'fields.difficulty']);
    expect(p.kinds.quiz?.title).toBe('Квиз');
    const bare = doc({ links: [{ rel: 'QUIZ_OF', dir: 'in', id: 'Q-1', type: 'quiz', title: 'Квиз', status: 'open' }] });
    expect(passportFromDoc(bare, { lang: 'ru', childColumns }).kinds.trail.relations?.[0].columns).toBeUndefined();
  });

  it('вычисляемое поле — в «Свойства» и в запись', () => {
    const p = passportFromDoc(doc(), { lang: 'ru', extraFields: () => [{ field: { key: 'heat', title: 'Тепло', type: 'number' }, value: 42 }] });
    expect(p.kinds.trail.fields?.[p.kinds.trail.fields.length - 1]).toEqual({ key: 'heat', title: 'Тепло', type: 'number' });
    expect(p.record.fields.heat).toBe(42);
  });

  it('сборщик не знает ни одного имени LORE — проверка грепом по исходнику', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(process.cwd(), 'src/record/recordDoc.ts'), 'utf8');
    const code = src.split('\n').filter(l => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
    for (const name of ['sprint', 'HAS_TASK', 'PART_OF', 'adr', "'task'"]) expect(code, name).not.toContain(name);
  });
});

describe('bodyMdIsOwnSection', () => {
  it('копия другого раздела тела — не свой раздел', () => {
    const d = doc();
    expect(bodyMdIsOwnSection(d)).toBe(true);
    d.schema.fields.push({ key: 'note_md', label: 'Заметка', kind: 'md', required: false, editable: true, group: 'body' });
    d.values.note_md = d.values.body_md;
    expect(bodyMdIsOwnSection(d)).toBe(false);
  });
});
