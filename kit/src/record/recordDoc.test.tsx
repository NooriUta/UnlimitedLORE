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
import { bodyMdIsOwnSection, passportFromDoc, type KitDocRelation, type KitRecordDoc } from './recordDoc';

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

// Пилот «Дата-странники», перевод Методологии на passportFromDoc (их PR #31, 16.11): где упёрлись.
describe('passportFromDoc · находки пилота 16.11', () => {
  it('элемент части несёт СВОЙ вид: смешанная часть (свитки и квизы) — не «any»', () => {
    const p = passportFromDoc(doc({ parts: [{ key: 'on', label: 'На тропе', rel: 'ON_TRAIL', dir: 'in', state: 'ok', count: 2,
      items: [{ id: 'S-1', title: 'Свиток', status: 'open', type: 'scroll' }, { id: 'Q-1', title: 'Квиз', status: 'open', type: 'quiz' }] }] }), { lang: 'ru' });
    const kinds = Object.fromEntries(p.data.records.map(r => [r.id, r.kind]));
    expect(kinds['S-1']).toBe('scroll');
    expect(kinds['Q-1']).toBe('quiz');
  });

  it('колонки части — по связи (свойства ребра: сторона, t), а не по виду ребёнка', () => {
    const p = passportFromDoc(doc({ parts: [{ key: 'on', label: 'На тропе', type: 'quiz', rel: 'ON_TRAIL', dir: 'in', state: 'ok', count: 2,
      items: [{ id: 'Q-1', title: 'Квиз', status: 'open', values: { side: 'A', t: 1 } }, { id: 'Q-1b', title: 'Квиз', status: 'open', values: { side: 'B', t: 2 } }] }] }),
    { lang: 'ru', partColumns: part => (part.rel === 'ON_TRAIL' ? ['fields.side', 'fields.t'] : undefined) });
    const ctx = { config: { modules: [], menu: { groups: [] }, kinds: p.kinds, statuses: { items: [] } }, data: p.data, href: (id: string) => '#' + id, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
    render(<KitLangProvider lang="ru">{p.kinds.trail.tabs!.find(t => t.key === 'on')!.render(p.record, ctx)}</KitLangProvider>);
    const heads = [...document.querySelectorAll('th')].map(th => th.textContent?.toLowerCase() ?? '');
    expect(heads.some(h => h.includes('side'))).toBe(true);
  });

  it('виды полей документа list и kv — часть контракта и доходят до поля вида', () => {
    const d = doc();
    d.schema.fields.push({ key: 'dreams_list', label: 'Сны', kind: 'list', required: false, editable: false, group: 'props' });
    d.schema.fields.push({ key: 'numbers', label: 'Числа', kind: 'kv', required: false, editable: false, group: 'props' });
    const p = passportFromDoc(d, { lang: 'ru' });
    expect(p.kinds.trail.fields?.find(f => f.key === 'dreams_list')?.type).toBe('list');
    expect(p.kinds.trail.fields?.find(f => f.key === 'numbers')?.type).toBe('kv');
  });
});

// Методика §7.8 (SPEC-LORE-MODEL-PASSPORT-METHOD, «предложено»): место показа по сторонам связи и
// подпись группы ассоциаций — обратно-совместимым расширением, без смены поведения по умолчанию.
describe('passportFromDoc · место по сторонам и подпись группы (§7.8)', () => {
  const rel = (place: KitDocRelation['place'], dir: 'out' | 'in') =>
    ({ key: 'next', label: 'Следующая', relation: 'association' as const, rel: 'NEXT', dir, count: 0, place });

  it('place объектом {out,in}: для записи берётся СВОЯ сторона', () => {
    const asOut = passportFromDoc(doc({ schema: { ...doc().schema, relations: [rel({ out: 'prop', in: 'link_tab' }, 'out')] } }), { lang: 'ru' });
    expect(asOut.kinds.trail.fields?.some(f => f.key === 'next')).toBe(true); // prop — поле
    const asIn = passportFromDoc(doc({ schema: { ...doc().schema, relations: [rel({ out: 'prop', in: 'link_tab' }, 'in')] } }), { lang: 'ru' });
    expect(asIn.kinds.trail.relations?.map(r => r.key)).toEqual(['next']); // link_tab — связь kit
  });

  it('place строкой — как раньше; не задан — вкладка связей (умолчание не меняется)', () => {
    const s = passportFromDoc(doc({ schema: { ...doc().schema, relations: [rel('prop', 'out')] } }), { lang: 'ru' });
    expect(s.kinds.trail.fields?.some(f => f.key === 'next')).toBe(true);
    const none = passportFromDoc(doc({ schema: { ...doc().schema, relations: [rel(undefined, 'out')] } }), { lang: 'ru' });
    expect(none.kinds.trail.relations?.map(r => r.key)).toEqual(['next']);
  });

  it('подпись группы ассоциаций из документа доходит до вида; нет — подписи нет (запасное «Зависимости» у kit)', () => {
    const p = passportFromDoc(doc({ schema: { ...doc().schema, relation_groups: { association: 'По смыслу' } } }), { lang: 'ru' });
    expect(p.kinds.trail.relationGroups).toEqual({ association: 'По смыслу' });
    expect(passportFromDoc(doc(), { lang: 'ru' }).kinds.trail.relationGroups).toBeUndefined();
  });
});

// Пилот 16.11, после #1496: колонки части по связи рисовали «нет у типа» (S4-35 смотрел в поля вида
// ребёнка, а t и side — свойства связи) и сырые ключи T, SIDE в заголовке.
describe('passportFromDoc · колонки части — значения и подписи (пилот 16.11)', () => {
  it('значение свойства связи в ячейке, а не «нет у типа»; заголовок — подпись приложения', () => {
    const p = passportFromDoc(doc({ parts: [{ key: 'on', label: 'На тропе', type: 'quiz', rel: 'ON_TRAIL', dir: 'in', state: 'ok', count: 1,
      items: [{ id: 'Q-1', title: 'Квиз', status: 'open', values: { side: 'A', t: 0.15 } }] }] }),
    { lang: 'ru', partColumns: () => [{ key: 'fields.side', label: 'Сторона' }, { key: 'fields.t', label: 'Место на тропе' }] });
    const ctx = { config: { modules: [], menu: { groups: [] }, kinds: { ...p.kinds, quiz: { title: 'Квиз', icon: 'checkbox-tree', fields: [{ key: 'q', title: 'Вопрос', type: 'text' }] } }, statuses: { items: [] } },
      data: p.data, href: (id: string) => '#' + id, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
    render(<KitLangProvider lang="ru">{p.kinds.trail.tabs!.find(t => t.key === 'on')!.render(p.record, ctx)}</KitLangProvider>);
    const heads = [...document.querySelectorAll('th')].map(th => th.textContent ?? '');
    expect(heads.some(h => h.includes('Сторона'))).toBe(true);
    expect(heads.some(h => h.includes('Место на тропе'))).toBe(true);
    expect(document.querySelector('.sk-list__na')).toBeNull();
    expect(document.body.textContent).toContain('0.15');
  });
});

// Методика §7.8, шаг 1 (слово сессии модели 16.11): явное место стороны побеждает OWN_TAB — ТОЛЬКО
// при объектной форме place {out, in}. Строка и «не задано» — как раньше (LORE не меняется).
describe('passportFromDoc · место стороны побеждает OWN_TAB только при {out,in}', () => {
  const agg = (place: KitDocRelation['place']) => ({ key: 'trails', label: 'Лежит на тропах', relation: 'aggregation' as const, rel: 'ON_TRAIL', dir: 'in' as const, count: 0, place });

  it('{out: part, in: link_tab}, запись на стороне in — связь помечена в общую вкладку', () => {
    const p = passportFromDoc(doc({ schema: { ...doc().schema, relations: [agg({ out: 'part', in: 'link_tab' })] } }), { lang: 'ru' });
    expect(p.kinds.trail.relations?.find(r => r.key === 'trails')?.shared).toBe(true);
  });

  it('строка link_tab и «не задано» — без пометки, своя вкладка как раньше', () => {
    for (const place of ['link_tab', undefined] as const) {
      const p = passportFromDoc(doc({ schema: { ...doc().schema, relations: [agg(place)] } }), { lang: 'ru' });
      expect(p.kinds.trail.relations?.find(r => r.key === 'trails')?.shared, String(place)).toBeUndefined();
    }
  });
});

// Пилот 16.11: квиз стоит на одной тропе дважды (t 0.15/A и 0.75/B) — во вкладке связей две строки
// выглядели одинаковыми: свойства ребра не доходили до ячеек. Подписи свойств — у связи (`props`).
describe('passportFromDoc · свойства ребра колонками во вкладке связей', () => {
  it('у каждого ребра — свои значения; заголовки — подписи props', async () => {
    const { RecordRelations } = await import('./RecordRelations');
    const rel = { key: 'onTrail', label: 'Квизы на тропе', relation: 'association' as const, rel: 'ON_TRAIL', dir: 'out' as const, count: 2,
      target_type: 'quiz', props: [{ key: 't', label: 'Место на тропе' }, { key: 'side', label: 'Сторона' }] };
    const p = passportFromDoc(doc({
      schema: { ...doc().schema, relations: [rel] },
      links: [
        { rel: 'ON_TRAIL', dir: 'out', id: 'Q-1', type: 'quiz', title: 'Квиз', status: 'open', values: { t: 0.15, side: 'A' } },
        { rel: 'ON_TRAIL', dir: 'out', id: 'Q-1', type: 'quiz', title: 'Квиз', status: 'open', values: { t: 0.75, side: 'B' } },
      ],
    }), { lang: 'ru' });
    const ctx = { config: { modules: [], menu: { groups: [] }, kinds: { ...p.kinds, quiz: { title: 'Квиз', icon: 'checkbox-tree' } }, statuses: { items: [] } },
      data: p.data, href: (id: string) => '#' + id, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
    render(<KitLangProvider lang="ru"><RecordRelations record={p.record} ctx={ctx} defs={p.kinds.trail.relations!} lang="ru" /></KitLangProvider>);
    const heads = [...document.querySelectorAll('th')].map(th => th.textContent ?? '');
    expect(heads.some(h => h.includes('Место на тропе'))).toBe(true);
    expect(heads.some(h => h.includes('Сторона'))).toBe(true);
    const rows = [...document.querySelectorAll('tbody tr')].map(tr => tr.textContent ?? '');
    expect(rows.some(r => r.includes('0.15') && r.includes('A'))).toBe(true);
    expect(rows.some(r => r.includes('0.75') && r.includes('B'))).toBe(true);
  });

  it('без props — общие колонки, как раньше', () => {
    const p = passportFromDoc(doc(), { lang: 'ru' });
    expect(p.kinds.trail.relations?.find(r => r.key === 'quizzes')?.fieldLabels).toBeUndefined();
  });
});
