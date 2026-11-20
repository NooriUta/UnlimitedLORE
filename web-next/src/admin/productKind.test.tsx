// @vitest-environment jsdom
// SPRINT_LORE_WORK_ANY_KIND/WK-01, часть «админка»: вид продукта ИТ / не ИТ (tech | service).
// Слово владелицы 20.11.2026: «правка вида — делай; с подтверждением и тестами до деплоя».
// Вид — НАБОР (ADR-LORE-044, решение 19.11): tech, service или оба; пустой набор нельзя.
// Правка — двумя переключателями (kit Pill filter), перед записью — kit ReasonDialog: причина
// обязательна и уходит в версию истории (сервер: reason → change_reason).
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, registerGameIcons } from '@seidr/kit';
import { DictsScreen } from './DictsScreen';
import { DICT_KINDS, dictEntryBody, dictEntryDiff, dictKindProblem, kindChanged, parseDictRows, type DictDraft } from './dicts';

beforeAll(() => { registerGameIcons(gameIcons); });
beforeEach(() => { window.history.replaceState(null, '', '/'); });

const ROW = (o: Record<string, unknown>) => ({
  dict_type: 'product', code: 'X', label_ru: 'Икс', label_en: null, color: null, icon: null,
  sort_order: 10, is_active: true, is_extensible: true, kind: null, ...o,
});
const DICT = [
  ROW({ code: 'AIDA', label_ru: 'AIDA', kind: ['tech'] }),
  ROW({ code: 'FREYJA', label_ru: 'Freyja', kind: 'service', sort_order: 20 }),
  ROW({ code: 'HARPA', label_ru: 'HARPA', kind: ['tech', 'service'], sort_order: 25 }),
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
const posts = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls
  .filter(c => (c[1] as RequestInit | undefined)?.method === 'POST')
  .map(c => JSON.parse(String((c[1] as RequestInit).body)) as Record<string, unknown>);
const mount = (f: typeof fetch) => render(<KitLangProvider lang="ru"><DictsScreen fetchImpl={f} /></KitLangProvider>);
const draft = (o: Partial<DictDraft> = {}): DictDraft => ({
  code: 'NEW', label_ru: 'Новый', label_en: null, color: null, icon: null, sort_order: 30, is_active: true, kind: [], ...o,
});
async function openEdit(code: string) {
  window.history.replaceState(null, '', '/?adm-dict=product');
  const f = fake();
  mount(f);
  fireEvent.click(within(await screen.findByTestId(`adm-dict-${code}`)).getByRole('button', { name: 'Править' }));
  return { f, form: await screen.findByTestId('adm-dict-form') };
}
const toggle = (form: HTMLElement, name: RegExp) => within(form).getByRole('button', { name });

describe('WK-01 · вид продукта — набор, правка с причиной', () => {
  it('набор видов — как у сервера; kind разбирается списком (строка прежней записи — набор из одного)', () => {
    expect(DICT_KINDS).toEqual({ product: ['tech', 'service'] });
    const rows = parseDictRows(DICT);
    expect(rows.find(r => r.code === 'AIDA')!.kind).toEqual(['tech']);
    expect(rows.find(r => r.code === 'FREYJA')!.kind).toEqual(['service']);
    expect(rows.find(r => r.code === 'HARPA')!.kind).toEqual(['tech', 'service']);
    expect(rows.find(r => r.code === 'NEW')!.kind).toEqual([]);
  });

  it('тело записи: kind у product — список в порядке tech, service; пустой — null; у словаря без видов ключа нет', () => {
    expect(dictEntryBody('product', draft({ kind: ['service', 'tech'] })).kind).toEqual(['tech', 'service']);
    expect(dictEntryBody('product', draft()).kind).toBeNull();
    expect('kind' in dictEntryBody('area', draft({ kind: ['tech'] }))).toBe(false);
    expect(dictEntryBody('product', draft({ kind: ['tech'] }), 'зачем').reason).toBe('зачем');
  });

  it('пустой набор у product — проблема; у словаря без видов — нет', () => {
    expect(dictKindProblem('product', draft())).toBe('empty');
    expect(dictKindProblem('product', draft({ kind: ['tech'] }))).toBeNull();
    expect(dictKindProblem('area', draft())).toBeNull();
  });

  it('смена вида — по набору, а не по порядку', () => {
    const before = parseDictRows([DICT[2]])[0];
    expect(kindChanged(before, draft({ kind: ['service', 'tech'] }))).toBe(false);
    expect(kindChanged(before, draft({ kind: ['tech'] }))).toBe(true);
    expect(kindChanged(null, draft({ kind: ['tech'] }))).toBe(true);
  });

  it('«было → станет»: строка вида — только у словаря с видами', () => {
    const before = parseDictRows([DICT[0]])[0];
    const d = dictEntryDiff(before, draft({ kind: ['tech', 'service'] }), 'product');
    expect(d.find(r => r.id === 'kind')).toMatchObject({ kind: 'change', from: 'tech', to: 'tech, service' });
    expect(dictEntryDiff(before, draft(), 'area').some(r => r.id === 'kind')).toBe(false);
  });

  it('список: колонка «Вид» показывает набор подписями', async () => {
    window.history.replaceState(null, '', '/?adm-dict=product');
    mount(fake());
    const kindOf = (code: string) => within(screen.getByTestId(`adm-dict-${code}`)).getByTestId('adm-dict-kind');
    await screen.findByTestId('adm-dict-AIDA');
    expect(kindOf('AIDA').getAttribute('data-kind')).toBe('tech');
    expect(kindOf('FREYJA').textContent).toMatch(/не ИТ/);
    expect(kindOf('HARPA').getAttribute('data-kind')).toBe('tech service');
    expect(kindOf('NEW').textContent).toMatch(/не задан/);
  });

  it('два переключателя tech и service: включить второй — набор из двух', async () => {
    const { form } = await openEdit('AIDA');
    const tech = toggle(form, /^ИТ/);
    const service = toggle(form, /^не ИТ/);
    expect(tech.getAttribute('aria-pressed')).toBe('true');
    expect(service.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(service);
    expect(service.getAttribute('aria-pressed')).toBe('true');
    expect(within(form).getByText('tech, service')).toBeTruthy();
  });

  it('пустой набор не записывается: оба выключены — предупреждение и «Применить» без записи', async () => {
    const { f, form } = await openEdit('AIDA');
    fireEvent.click(toggle(form, /^ИТ/));
    expect(within(form).getByTestId('adm-dict-kind-empty').textContent).toMatch(/хотя бы один/);
    fireEvent.click(within(form).getByRole('button', { name: /Применить/ }));
    expect(screen.queryByTestId('kit-reason-input')).toBeNull();
    await new Promise(r => setTimeout(r, 0));
    expect(posts(f)).toHaveLength(0);
  });

  it('смена вида: перед записью ReasonDialog, без причины подтвердить нельзя; причина уходит в тело', async () => {
    const { f, form } = await openEdit('AIDA');
    fireEvent.click(toggle(form, /^не ИТ/));
    fireEvent.click(within(form).getByRole('button', { name: /Применить/ }));
    const input = await screen.findByTestId('kit-reason-input');
    const dialog = input.closest('[role="dialog"]') as HTMLElement;
    const ok = within(dialog).getByRole('button', { name: 'Сохранить вид' });
    expect((ok as HTMLButtonElement).disabled).toBe(true);
    expect(posts(f)).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'AIDA продаёт и услуги' } });
    expect((ok as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(posts(f)[0]).toMatchObject({ dict_type: 'product', code: 'AIDA', kind: ['tech', 'service'], reason: 'AIDA продаёт и услуги' });
  });

  it('правка без смены вида — без диалога причины', async () => {
    const { f, form } = await openEdit('HARPA');
    fireEvent.change(within(form).getByLabelText('Метка ru'), { target: { value: 'HARPA 2' } });
    fireEvent.click(within(form).getByRole('button', { name: /Применить/ }));
    await waitFor(() => expect(posts(f)).toHaveLength(1));
    expect(screen.queryByTestId('kit-reason-input')).toBeNull();
    expect(posts(f)[0]).toMatchObject({ kind: ['tech', 'service'] });
    expect('reason' in posts(f)[0]).toBe(false);
  });

  it('у словаря без видов колонки и переключателей нет', async () => {
    window.history.replaceState(null, '', '/?adm-dict=area');
    mount(fake());
    const core = await screen.findByTestId('adm-dict-core');
    expect(within(core).queryByTestId('adm-dict-kind')).toBeNull();
    fireEvent.click(within(core).getByRole('button', { name: 'Править' }));
    expect(within(await screen.findByTestId('adm-dict-form')).queryByTestId('adm-dict-kinds')).toBeNull();
  });
});
