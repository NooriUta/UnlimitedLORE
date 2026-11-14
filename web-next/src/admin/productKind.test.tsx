// @vitest-environment jsdom
// SPRINT_LORE_WORK_ANY_KIND/WK-01, часть «админка»: вид продукта ИТ / не ИТ (tech | service) —
// показ и правка в статье словаря product. Сервер (#1335) принимает kind только у словаря с
// набором видов (product: tech | service); null — «не трогать», снять вид запись не умеет.
// Разметку существующих продуктов UI не делает — это решение владелицы.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { DictsScreen } from './DictsScreen';
import { DICT_KINDS, dictEntryBody, dictEntryDiff, parseDictRows, type DictDraft } from './dicts';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ROW = (o: Record<string, unknown>) => ({
  dict_type: 'product', code: 'X', label_ru: 'Икс', label_en: null, color: null, icon: null,
  sort_order: 10, is_active: true, is_extensible: true, kind: null, ...o,
});
const DICT = [
  ROW({ code: 'AIDA', label_ru: 'AIDA', kind: 'tech' }),
  ROW({ code: 'FREYJA', label_ru: 'Freyja', kind: 'service', sort_order: 20 }),
  ROW({ code: 'NEW', label_ru: 'Новый', sort_order: 30 }),
  ROW({ dict_type: 'area', code: 'core', label_ru: 'Ядро' }),
];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
function fake() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return json({ ok: true, outcome: 'updated' });
    if (url.startsWith('/lore/slice/dictionary')) return json({ rows: DICT });
    return json({ rows: [] });
  }) as unknown as typeof fetch;
}
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><DictsScreen fetchImpl={f} /></KitLangProvider>);
const draft = (o: Partial<DictDraft> = {}): DictDraft => ({
  code: 'NEW', label_ru: 'Новый', label_en: null, color: null, icon: null, sort_order: 30, is_active: true, kind: null, ...o,
});

describe('WK-01 · вид продукта в админке', () => {
  it('набор видов — как у сервера; kind разбирается из среза', () => {
    expect(DICT_KINDS).toEqual({ product: ['tech', 'service'] });
    const rows = parseDictRows(DICT);
    expect(rows.find(r => r.code === 'AIDA')!.kind).toBe('tech');
    expect(rows.find(r => r.code === 'NEW')!.kind).toBeNull();
  });

  it('тело записи: kind у product; у словаря без видов не шлётся; не задан — null (не трогать)', () => {
    expect(dictEntryBody('product', draft({ kind: 'service' })).kind).toBe('service');
    expect(dictEntryBody('product', draft()).kind).toBeNull();
    expect('kind' in dictEntryBody('area', draft({ kind: 'tech' }))).toBe(false);
  });

  it('«было → станет»: строка вида — только у словаря с видами', () => {
    const before = parseDictRows([DICT[2]])[0];
    const d = dictEntryDiff(before, draft({ kind: 'tech' }), 'product');
    expect(d.find(r => r.id === 'kind')).toMatchObject({ kind: 'add', detail: 'tech' });
    expect(dictEntryDiff(before, draft(), 'area').some(r => r.id === 'kind')).toBe(false);
  });

  it('словарь product: колонка «Вид», в форме — выбор; запись шлёт kind', async () => {
    window.history.replaceState(null, '', '/?adm-dict=product');
    const f = fake();
    mount(f);
    expect(within(await screen.findByTestId('adm-dict-AIDA')).getByTestId('adm-dict-kind').textContent).toMatch(/ИТ/);
    expect(within(screen.getByTestId('adm-dict-FREYJA')).getByTestId('adm-dict-kind').textContent).toMatch(/не ИТ/);
    expect(within(screen.getByTestId('adm-dict-NEW')).getByTestId('adm-dict-kind').textContent).toMatch(/не задан/);
    fireEvent.click(within(screen.getByTestId('adm-dict-NEW')).getByRole('button', { name: 'Править' }));
    const form = await screen.findByTestId('adm-dict-form');
    fireEvent.change(within(form).getByLabelText('Вид продукта'), { target: { value: 'service' } });
    fireEvent.click(within(form).getByRole('button', { name: /Применить/ }));
    const calls = (f as unknown as ReturnType<typeof vi.fn>).mock.calls;
    await waitFor(() => expect(calls.some(c => (c[1] as RequestInit | undefined)?.method === 'POST')).toBe(true));
    const post = calls.find(c => (c[1] as RequestInit | undefined)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ dict_type: 'product', code: 'NEW', kind: 'service' });
  });

  it('заданный вид снять нельзя — варианта «не задан» нет; у словаря без видов поля нет', async () => {
    window.history.replaceState(null, '', '/?adm-dict=product');
    mount(fake());
    fireEvent.click(within(await screen.findByTestId('adm-dict-AIDA')).getByRole('button', { name: 'Править' }));
    const sel = within(await screen.findByTestId('adm-dict-form')).getByLabelText('Вид продукта') as HTMLSelectElement;
    expect([...sel.options].map(o => o.value)).toEqual(['tech', 'service']);
  });

  it('у словаря без видов колонки и поля нет', async () => {
    window.history.replaceState(null, '', '/?adm-dict=area');
    mount(fake());
    const core = await screen.findByTestId('adm-dict-core');
    expect(within(core).queryByTestId('adm-dict-kind')).toBeNull();
    fireEvent.click(within(core).getByRole('button', { name: 'Править' }));
    expect(within(await screen.findByTestId('adm-dict-form')).queryByLabelText('Вид продукта')).toBeNull();
  });
});
