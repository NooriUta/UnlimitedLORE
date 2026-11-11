// @vitest-environment jsdom
// SPRINT_UXR_S7B_ADMIN/S7B-31 п.1 и п.3 — «Словари» в админке v2 (паритет со
// старой вкладкой v1 DictsTab/TagsTab, решение владелицы 11.11: 1а, 3б).
//
// Что держим:
//   • код залочен у существующего значения, правится только при создании;
//   • метки ru/en, цвет, иконка, порядок, активность — правятся;
//   • канон-словарь помечен, правка — только с подтверждением словом (kit DiffPreview);
//   • деактивация — тоже с подтверждением (в v1 — второй клик «Точно деактивировать?»);
//   • счётчик использования area: компоненты не прочитаны — «не смогли посчитать», не 0;
//   • запись — тем же путём, что у v1: POST /lore/dict/entry (UI — человек, без human_approval);
//   • вкладка «Теги» — только чтение, срез tags_usage.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { DictsScreen } from './DictsScreen';
import {
  areaUsageOf, checkNewDictType, dictEntryBody, dictEntryDiff, dictTypes, isCanonDict, needsDictConfirm,
  parseDictRows, usageOf, type DictDraft,
} from './dicts';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ROW = (o: Record<string, unknown>) => ({
  dict_type: 'area', code: 'x', label_ru: 'Икс', label_en: null, color: null, icon: null,
  sort_order: 10, is_active: true, is_extensible: true, ...o,
});
const DICT = [
  ROW({ code: 'core', label_ru: 'Ядро', color: 'var(--acc)', icon: 'gears' }),
  ROW({ code: 'ui', label_ru: 'Интерфейс', sort_order: 20 }),
  ROW({ code: 'old', label_ru: 'Старое', sort_order: 30, is_active: false }),
  ROW({ dict_type: 'task_status', code: 'DONE', label_ru: 'Готово' }),
];
const COMPONENTS = [{ component_id: 'C1', area: 'core' }, { component_id: 'C2', area: 'core' }, { component_id: 'C3', area: null }];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

interface FakeOpts { components?: number; dict?: number; tags?: number; post?: number }
function fake(o: FakeOpts = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return o.post ? json({ error: 'FORBIDDEN', detail: 'admin only' }, o.post) : json({ ok: true, outcome: 'updated' });
    }
    if (url.startsWith('/lore/slice/dictionary')) return o.dict ? json({ error: 'FORBIDDEN', detail: 'no' }, o.dict) : json({ rows: DICT });
    if (url.startsWith('/lore/slice/components')) return o.components ? json({ error: 'DOWN', detail: 'graph down' }, o.components) : json({ rows: COMPONENTS });
    if (url.startsWith('/lore/slice/tags_usage')) {
      return o.tags ? json({ error: 'DOWN', detail: 'down' }, o.tags) : json({ rows: [{ tag_id: 'Alpha', uses: 3 }, { tag_id: 'zeta', uses: 0 }] });
    }
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}

const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><DictsScreen fetchImpl={f} /></KitLangProvider>);

describe('S7B-31 · модель словарей', () => {
  it('строки слайса разбираются, типы — по алфавиту со счётом', () => {
    const rows = parseDictRows(DICT);
    expect(dictTypes(rows)).toEqual([{ type: 'area', n: 3 }, { type: 'task_status', n: 1 }]);
    expect(rows[2].is_active).toBe(false);
  });

  it('канон-словари — четыре статусных', () => {
    for (const t of ['adr_status', 'sprint_status', 'task_status', 'priority']) expect(isCanonDict(t), t).toBe(true);
    expect(isCanonDict('area')).toBe(false);
  });

  it('использование area: компоненты прочитаны — счёт; не прочитаны или обрезаны — «не смогли», не 0', () => {
    const ok = areaUsageOf(COMPONENTS, false);
    expect(usageOf('area', 'core', ok)).toEqual({ kind: 'n', n: 2 });
    expect(usageOf('area', 'ui', ok)).toEqual({ kind: 'n', n: 0 });
    // Счёт ведётся только для area — у прочих словарей «н/д», а не 0.
    expect(usageOf('task_status', 'DONE', ok)).toEqual({ kind: 'na' });
    expect(usageOf('area', 'core', areaUsageOf(COMPONENTS, true))).toMatchObject({ kind: 'unknown' });
    expect(usageOf('area', 'core', { state: 'unknown', reason: 'graph down' })).toEqual({ kind: 'unknown', reason: 'graph down' });
  });

  it('новый тип: строчная латиница с буквы; существующий — открыть', () => {
    expect(checkNewDictType('', ['area'])).toEqual({ kind: 'empty' });
    expect(checkNewDictType('Bad-Type', ['area'])).toEqual({ kind: 'bad' });
    expect(checkNewDictType(' area ', ['area'])).toEqual({ kind: 'exists', code: 'area' });
    expect(checkNewDictType('release_kind', ['area'])).toEqual({ kind: 'new', code: 'release_kind' });
  });

  it('дифф правки — по полям: смена, добавление, снятие; код у существующего не меняется', () => {
    const before = parseDictRows(DICT)[0];
    const draft: DictDraft = { code: 'core', label_ru: 'Ядро LORE', label_en: 'Core', color: null, icon: 'gears', sort_order: 10, is_active: true };
    const rows = dictEntryDiff(before, draft);
    expect(rows.find(r => r.id === 'label_ru')).toMatchObject({ kind: 'change', from: 'Ядро', to: 'Ядро LORE' });
    expect(rows.find(r => r.id === 'label_en')).toMatchObject({ kind: 'add' });
    expect(rows.find(r => r.id === 'color')).toMatchObject({ kind: 'remove' });
    expect(rows.find(r => r.id === 'icon')).toMatchObject({ kind: 'same' });
    expect(rows.find(r => r.id === 'code')).toMatchObject({ kind: 'same' });
    // Новое значение: всё, что задано, — добавление.
    const fresh = dictEntryDiff(null, { ...draft, code: 'new', color: 'var(--suc)' });
    expect(fresh.find(r => r.id === 'code')).toMatchObject({ kind: 'add' });
    expect(fresh.find(r => r.id === 'color')).toMatchObject({ kind: 'add' });
  });

  it('подтверждение словом: канон-словарь всегда, деактивация — всегда', () => {
    const before = parseDictRows(DICT)[0];
    const same: DictDraft = { ...before };
    expect(needsDictConfirm('area', before, same)).toBe(false);
    expect(needsDictConfirm('task_status', before, same)).toBe(true);
    expect(needsDictConfirm('area', before, { ...same, is_active: false })).toBe(true);
  });

  it('тело записи — тот же контракт, что у v1 (/dict/entry, partial-safe: is_extensible=null, пусто → null)', () => {
    expect(dictEntryBody('area', { code: ' core ', label_ru: 'Ядро', label_en: '', color: '', icon: null, sort_order: 10, is_active: true })).toEqual({
      dict_type: 'area', code: 'core', label_ru: 'Ядро', label_en: null, color: null, icon: null, sort_order: 10, is_active: true, is_extensible: null,
    });
  });
});

describe('S7B-31 · экран «Словари»', () => {
  it('типы — чипами, канон помечен; таблица значений с счётом использования area', async () => {
    mount(fake());
    const chips = await screen.findByTestId('adm-dicts-types');
    expect(within(chips).getByRole('button', { name: /area/ }).getAttribute('aria-pressed')).toBe('true');
    expect(within(chips).getByRole('button', { name: /task_status/ }).getAttribute('data-canon')).toBe('true');
    const core = await screen.findByTestId('adm-dict-core');
    expect(within(core).getByTestId('adm-dict-uses').textContent).toBe('2');
    // По умолчанию — только активные; «old» отключён и скрыт.
    expect(screen.queryByTestId('adm-dict-old')).toBeNull();
    fireEvent.click(screen.getByTestId('adm-dicts-all'));
    expect(await screen.findByTestId('adm-dict-old')).toBeTruthy();
  });

  it('компоненты не прочитаны — счёт «не смогли посчитать», а не 0', async () => {
    mount(fake({ components: 502 }));
    const core = await screen.findByTestId('adm-dict-core');
    const uses = within(core).getByTestId('adm-dict-uses');
    expect(uses.getAttribute('data-state')).toBe('unknown');
    expect(uses.textContent).not.toBe('0');
    expect(screen.getByTestId('adm-dicts-usage-error').textContent).toMatch(/не смогли посчитать/i);
  });

  it('словарь не прочитан: 403 — «нет прав», а не пустой список', async () => {
    mount(fake({ dict: 403 }));
    expect(await screen.findByText(/нет прав|доступ/i)).toBeTruthy();
    expect(screen.queryByTestId('adm-dicts-types')).toBeNull();
  });

  it('правка: код залочен, метки ru/en; «Применить» пишет в /lore/dict/entry', async () => {
    const f = fake();
    mount(f);
    const core = await screen.findByTestId('adm-dict-core');
    fireEvent.click(within(core).getByRole('button', { name: 'Править' }));
    const form = await screen.findByTestId('adm-dict-form');
    const code = within(form).getByLabelText('Код') as HTMLInputElement;
    expect(code.readOnly).toBe(true);
    fireEvent.change(within(form).getByLabelText('Метка en'), { target: { value: 'Core' } });
    fireEvent.click(within(form).getByRole('button', { name: /Применить/ }));
    await waitFor(() => expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.some(c => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const post = (f as unknown as ReturnType<typeof vi.fn>).mock.calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(post[0]).toBe('/lore/dict/entry');
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ dict_type: 'area', code: 'core', label_en: 'Core', is_extensible: null });
    expect(String((post[1] as RequestInit).body)).not.toContain('human_approval');
  });

  it('канон-словарь: предупреждение, без ввода кода «Применить» занята', async () => {
    window.history.replaceState(null, '', '/?adm-dict=task_status');
    mount(fake());
    expect(await screen.findByTestId('adm-dicts-canon')).toBeTruthy();
    const row = await screen.findByTestId('adm-dict-DONE');
    fireEvent.click(within(row).getByRole('button', { name: 'Править' }));
    const form = await screen.findByTestId('adm-dict-form');
    fireEvent.change(within(form).getByLabelText('Метка ru'), { target: { value: 'Сделано' } });
    // kit DiffPreview держит кнопку aria-disabled и не зовёт применение, пока код не введён.
    expect(within(form).getByRole('button', { name: /Применить/ }).getAttribute('aria-disabled')).toBe('true');
    expect(within(form).getByTestId('kit-diff-blocked')).toBeTruthy();
    fireEvent.change(within(form).getByLabelText(/Введите код/), { target: { value: 'DONE' } });
    expect(within(form).getByRole('button', { name: /Применить/ }).getAttribute('aria-disabled')).toBeNull();
  });

  it('отказ записи назван словами сервера', async () => {
    mount(fake({ post: 403 }));
    const core = await screen.findByTestId('adm-dict-core');
    fireEvent.click(within(core).getByRole('button', { name: 'Править' }));
    const form = await screen.findByTestId('adm-dict-form');
    fireEvent.change(within(form).getByLabelText('Метка ru'), { target: { value: 'Ядро 2' } });
    fireEvent.click(within(form).getByRole('button', { name: /Применить/ }));
    expect((await screen.findByTestId('adm-dict-save-error')).textContent).toMatch(/admin only/);
  });

  it('неизвестная иконка — сказано словами, с похожими', async () => {
    mount(fake());
    const core = await screen.findByTestId('adm-dict-core');
    fireEvent.click(within(core).getByRole('button', { name: 'Править' }));
    const form = await screen.findByTestId('adm-dict-form');
    fireEvent.change(within(form).getByLabelText(/Иконка/), { target: { value: 'gearz' } });
    expect(within(form).getByTestId('adm-dict-icon-bad').textContent).toMatch(/нет/);
  });

  it('новый тип: «Завести тип» открывает форму первой записи с открытым кодом', async () => {
    mount(fake());
    await screen.findByTestId('adm-dicts-types');
    fireEvent.change(screen.getByLabelText('Новый тип справочника'), { target: { value: 'release_kind' } });
    fireEvent.click(screen.getByRole('button', { name: 'Завести тип' }));
    const form = await screen.findByTestId('adm-dict-form');
    expect((within(form).getByLabelText('Код') as HTMLInputElement).readOnly).toBe(false);
  });
});

describe('S7B-31 · вкладка «Теги» (только чтение)', () => {
  it('теги из tags_usage, по использованию; неиспользуемый — кандидат на удаление; правки нет', async () => {
    window.history.replaceState(null, '', '/?adm-dicts-tab=tags');
    mount(fake());
    const table = await screen.findByTestId('adm-tags');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map(r => r.getAttribute('data-tag'))).toEqual(['Alpha', 'zeta']);
    expect(within(rows[1]).getByText(/кандидат на удаление/)).toBeTruthy();
    expect(within(table).queryByRole('button', { name: /Править/ })).toBeNull();
    // Поиск без учёта регистра, сортировка по алфавиту.
    fireEvent.change(screen.getByLabelText('Поиск тега'), { target: { value: 'alp' } });
    expect(within(screen.getByTestId('adm-tags')).getAllByRole('row')).toHaveLength(2);
  });

  it('теги не прочитаны — сбой, а не «тегов нет»', async () => {
    window.history.replaceState(null, '', '/?adm-dicts-tab=tags');
    mount(fake({ tags: 502 }));
    await waitFor(() => expect(screen.queryByTestId('adm-tags')).toBeNull());
    expect(await screen.findByRole('button', { name: /Повторить|ещё раз/i })).toBeTruthy();
  });
});
