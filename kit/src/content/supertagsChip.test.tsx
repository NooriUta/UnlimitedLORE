// @vitest-environment jsdom
// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE, шаг «г» прототипа docs/prototypes/supertags-spike.html:
//   1 · в TipTap токен [[ЗАПИСЬ#тег]] виден ЧИПОМ «#тег» с краткими полями (до трёх значений), а не исходником;
//       markdown при этом не меняется — это только отображение;
//   2 · щелчок по чипу — поповер полей ребра TAGGED_WITH: правка уходит через source.apply (null снимает поле),
//       «Снять тег» — подтверждением в самом поповере (не confirm()); честно «Сохраняю…» и «Не сохранилось: причина».
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

import { TipTapField } from './TipTapField';
import type { TipTapRefSource, TipTapTagSource } from './TipTapField';
import { getMarkdown } from './tiptapMd';

afterEach(cleanup);

const EDGE = { fields: { reviewer: 'arharaga', risk: 'high', due: '2026-11-27', verdict: 'нужна санитизация' }, changed_at: '2026-11-20T10:00:00Z', changed_by: 'arharaga' };
const BODY = 'Разбор: [[ADR-LORE-050#security-review]] дальше';

const tagSource = (over: Partial<TipTapTagSource> = {}): TipTapTagSource => ({
  host: 'ADR-LORE-050',
  search: vi.fn(async () => []),
  apply: vi.fn(async (_t: string, f: Record<string, string | null>) => ({ ok: true as const, fields: Object.fromEntries(Object.entries({ ...EDGE.fields, ...f }).filter(([, v]) => v != null)) as Record<string, string> })),
  fields: vi.fn(async () => EDGE),
  remove: vi.fn(async () => ({ ok: true as const })),
  ...over,
});

const refs = (tags: TipTapTagSource): TipTapRefSource => ({ types: { adr: 'adr' }, typeLabels: { adr: 'ADR' }, search: vi.fn(async () => []), tags });

async function mount(tags: TipTapTagSource, value = BODY) {
  const onChange = vi.fn();
  const r = render(<TipTapField value={value} onChange={onChange} ariaLabel="Тело" refs={refs(tags)} />);
  await waitFor(() => expect(r.container.querySelector('.ProseMirror')).toBeTruthy());
  const editor = (r.container.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
  const chip = () => r.container.querySelector('.sk-md__tagchip') as HTMLElement | null;
  return { ...r, editor, chip, onChange };
}

const lastMd = (f: { onChange: ReturnType<typeof vi.fn> }) => f.onChange.mock.calls[f.onChange.mock.calls.length - 1]?.[0] as string | undefined;

describe('чип тега в TipTap', () => {
  it('токен рисуется чипом «#тег» с тремя значениями полей; исходника не видно; markdown тот же', async () => {
    const tags = tagSource();
    const f = await mount(tags);
    await waitFor(() => expect(f.chip()?.textContent).toContain('arharaga'));
    const text = f.chip()!.textContent!;
    expect(text).toContain('#security-review');
    expect(text).toContain('high');
    expect(text).toContain('2026-11-27');
    expect(text).not.toContain('нужна санитизация');
    expect(text).toContain('+1');
    expect(text).not.toContain('[[');
    expect(tags.fields).toHaveBeenCalledWith('security-review');
    expect(getMarkdown(f.editor)).toContain('[[ADR-LORE-050#security-review]]');
  });

  it('поля не загрузились — чип говорит об этом, а не молчит пустым', async () => {
    const f = await mount(tagSource({ fields: vi.fn(async () => { throw new Error('502 от /lore/tag/entities'); }) }));
    await waitFor(() => expect(f.chip()?.getAttribute('data-tag-state')).toBe('error'));
    expect(f.chip()!.getAttribute('title')).toMatch(/502/);
  });

  it('обычная ссылка [[adr:ADR-1]] чипом тега не становится', async () => {
    const f = await mount(tagSource(), 'см. [[adr:ADR-1]]');
    expect(f.chip()).toBeNull();
    expect(f.container.querySelector('.sk-md__raw--wikilink')?.textContent).toBe('[[adr:ADR-1]]');
  });
});

describe('правка полей щелчком по чипу', () => {
  it('поменяли поле и сняли другое — уходит patch с null; «Сохраняю…» видно; чип обновился', async () => {
    let release: () => void = () => {};
    const tags = tagSource();
    const applied = tags.apply as ReturnType<typeof vi.fn>;
    const inner = applied.getMockImplementation() as (t: string, p: Record<string, string | null>) => unknown;
    applied.mockImplementation((t: string, p: Record<string, string | null>) => new Promise(res => { release = () => res(inner(t, p)); }));
    const f = await mount(tags);
    await waitFor(() => expect(f.chip()?.textContent).toContain('high'));
    fireEvent.click(f.chip()!);
    const pop = await screen.findByRole('dialog', { name: /Поля тега/ });
    fireEvent.change(within(pop).getByLabelText('risk'), { target: { value: 'low' } });
    fireEvent.click(within(pop).getByRole('button', { name: 'Снять поле verdict' }));
    fireEvent.click(within(pop).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(within(pop).getByText('Сохраняю…')).toBeTruthy());
    expect(tags.apply).toHaveBeenCalledWith('security-review', { risk: 'low', verdict: null });
    await act(async () => { release(); });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Поля тега/ })).toBeNull());
    expect(f.chip()!.textContent).toContain('low');
    expect(getMarkdown(f.editor)).toContain('[[ADR-LORE-050#security-review]]');
  });

  it('отказ сервера — «Не сохранилось: причина», поповер не закрывается', async () => {
    const f = await mount(tagSource({ apply: vi.fn(async () => ({ ok: false as const, reason: '403 нет прав' })) }));
    await waitFor(() => expect(f.chip()?.textContent).toContain('high'));
    fireEvent.click(f.chip()!);
    const pop = await screen.findByRole('dialog', { name: /Поля тега/ });
    fireEvent.change(within(pop).getByLabelText('risk'), { target: { value: 'low' } });
    fireEvent.click(within(pop).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(within(pop).getByRole('alert').textContent).toBe('Не сохранилось: 403 нет прав.'));
    expect(screen.getByRole('dialog', { name: /Поля тега/ })).toBeTruthy();
    expect(f.chip()!.textContent).toContain('high');
  });

  it('«Снять тег» — подтверждение в поповере, не confirm(); после «Да» тег снят и токена в тексте нет', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    const tags = tagSource();
    const f = await mount(tags);
    await waitFor(() => expect(f.chip()?.textContent).toContain('high'));
    fireEvent.click(f.chip()!);
    const pop = await screen.findByRole('dialog', { name: /Поля тега/ });
    fireEvent.click(within(pop).getByRole('button', { name: 'Снять тег' }));
    expect(within(pop).getByText(/Снять #security-review с ADR-LORE-050\?/)).toBeTruthy();
    expect(tags.remove).not.toHaveBeenCalled();
    fireEvent.click(within(pop).getByRole('button', { name: 'Да, снять' }));
    await waitFor(() => expect(tags.remove).toHaveBeenCalledWith('security-review'));
    await waitFor(() => expect(lastMd(f)).not.toContain('#security-review'));
    expect(lastMd(f)).toContain('Разбор:');
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('отказ снятия — причиной, токен остаётся', async () => {
    const f = await mount(tagSource({ remove: vi.fn(async () => ({ ok: false as const, reason: '502 ArcadeDB' })) }));
    await waitFor(() => expect(f.chip()?.textContent).toContain('high'));
    fireEvent.click(f.chip()!);
    const pop = await screen.findByRole('dialog', { name: /Поля тега/ });
    fireEvent.click(within(pop).getByRole('button', { name: 'Снять тег' }));
    fireEvent.click(within(pop).getByRole('button', { name: 'Да, снять' }));
    await waitFor(() => expect(within(pop).getByRole('alert').textContent).toBe('Тег не снят: 502 ArcadeDB.'));
    expect(getMarkdown(f.editor)).toContain('[[ADR-LORE-050#security-review]]');
  });

  it('тег чужой записи — чип без правки, щелчок поповер не открывает', async () => {
    const tags = tagSource();
    const f = await mount(tags, 'см. [[ADR-OTHER#security-review]]');
    expect(f.chip()).toBeTruthy();
    fireEvent.click(f.chip()!);
    expect(screen.queryByRole('dialog', { name: /Поля тега/ })).toBeNull();
    expect(tags.fields).not.toHaveBeenCalled();
  });
});
