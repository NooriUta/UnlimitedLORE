// @vitest-environment jsdom
// SPRINT_LORE_PRODUCT_BACKLOG/SUPERTAGS-SPIKE — поток «#тег» в TipTap (прототип docs/prototypes/supertags-spike.html,
// «ок по sypertag» 20.11.2026): «#» перед словом, которое не тип записи, открывает окно ТЕГОВ; выбрали тег — его
// поля к заполнению (все необязательны); «Поставить тег» пишет поля на ребро (через приложение), а в текст
// ложится ОДИН токен [[ЗАПИСЬ#тег]] — значения в текст не попадают. Честные состояния: не нашлось ≠ не загрузилось.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/react';

import { TipTapField } from './TipTapField';
import type { TipTapRefSource, TipTapTagSource } from './TipTapField';
import { refsInMd, tagToken } from './refTrigger';
import { refIdOfRaw } from './refPasteCheck';
import { marked } from './markdown';

const renderMarkdown = (md: string) => marked.parse(md, { async: false }) as string;

const TAGS = [
  { tag: 'security-review', uses: 7, keys: ['reviewer', 'risk', 'due', 'verdict'] },
  { tag: 'secrets-touch', uses: 2, keys: ['vault_path'] },
];

const tagSource = (over: Partial<TipTapTagSource> = {}): TipTapTagSource => ({
  host: 'ADR-LORE-050',
  search: vi.fn(async (q: string) => TAGS.filter(t => t.tag.includes(q))),
  apply: vi.fn(async () => ({ ok: true as const })),
  ...over,
});

const source = (tags?: TipTapTagSource): TipTapRefSource => ({
  types: { adr: 'adr', task: 'task' },
  typeLabels: { adr: 'ADR', task: 'задача' },
  search: vi.fn(async () => []),
  ...(tags ? { tags } : {}),
});

async function mount(refs: TipTapRefSource) {
  const onChange = vi.fn();
  const r = render(<TipTapField value="" onChange={onChange} ariaLabel="Тело" refs={refs} />);
  await waitFor(() => expect(r.container.querySelector('.ProseMirror')).toBeTruthy());
  const editor = (r.container.querySelector('.ProseMirror') as unknown as { editor: Editor }).editor;
  const type = (s: string) => act(() => { editor.view.dom.focus(); editor.chain().focus('end').insertContent(s).run(); });
  const md = () => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0] as string | undefined;
  const settle = () => act(async () => { await new Promise(res => setTimeout(res, 40)); });
  return { ...r, editor, type, md, settle };
}

describe('токен [[ЗАПИСЬ#тег]] — форма', () => {
  it('tagToken и разбор: id записи отдельно от тега', () => {
    expect(tagToken('ADR-LORE-050', 'security-review')).toBe('[[ADR-LORE-050#security-review]]');
    expect(refsInMd('Разбор: [[ADR-LORE-050#security-review]] и [[adr:ADR-1]]')).toEqual([
      { id: 'ADR-LORE-050', type: null, tag: 'security-review' },
      { id: 'ADR-1', type: 'adr' },
    ]);
    expect(refIdOfRaw('[[ADR-LORE-050#security-review]]')).toBe('ADR-LORE-050');
  });

  it('в чтении — чип тега, а не ссылка на «ADR-LORE-050#security-review»', () => {
    const html = renderMarkdown('Разбор: [[ADR-LORE-050#security-review]]');
    expect(html).toContain('sk-wref--tag');
    expect(html).toContain('data-ref="ADR-LORE-050"');
    expect(html).toContain('data-tag="security-review"');
    expect(html).toContain('#security-review');
  });
});

describe('TipTapField — поток «#тег»', () => {
  it('а · «#sec» открывает окно тегов: сколько записей и какие поля', async () => {
    const tags = tagSource();
    const f = await mount(source(tags));
    await f.type('Разбор: #sec');
    await waitFor(() => expect(screen.getByText('#security-review')).toBeTruthy());
    expect(tags.search).toHaveBeenLastCalledWith('sec');
    expect(screen.getByText('#secrets-touch')).toBeTruthy();
    expect(screen.getByText('vault_path')).toBeTruthy();
    expect(screen.getByTestId('tag-head').textContent).toContain('sec');
    await f.settle();
  });

  it('б → в · выбрали тег, заполнили поле, «Поставить тег»: поля — на ребро, в текст — один токен', async () => {
    const tags = tagSource();
    const f = await mount(source(tags));
    await f.type('Разбор: #sec');
    await waitFor(() => expect(screen.getByText('#security-review')).toBeTruthy());
    fireEvent.click(screen.getByText('#security-review'));
    const risk = await screen.findByLabelText('risk');
    fireEvent.change(risk, { target: { value: 'medium' } });
    fireEvent.click(screen.getByRole('button', { name: 'Поставить тег' }));
    await waitFor(() => expect(f.md()).toContain('[[ADR-LORE-050#security-review]]'));
    expect(tags.apply).toHaveBeenCalledWith('security-review', { risk: 'medium' });
    expect(f.md()).not.toContain('medium');
    expect(f.md()).not.toContain('#sec ');
    await f.settle();
  });

  it('«Без полей» ставит голый тег', async () => {
    const tags = tagSource();
    const f = await mount(source(tags));
    await f.type('см. #secr');
    fireEvent.click(await screen.findByText('#secrets-touch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Без полей' }));
    await waitFor(() => expect(f.md()).toContain('[[ADR-LORE-050#secrets-touch]]'));
    expect(tags.apply).toHaveBeenCalledWith('secrets-touch', {});
    await f.settle();
  });

  it('отказ записи — причиной в окне, токен в текст не ложится', async () => {
    const tags = tagSource({ apply: vi.fn(async () => ({ ok: false as const, reason: '403 нет прав' })) });
    const f = await mount(source(tags));
    await f.type('см. #secr');
    fireEvent.click(await screen.findByText('#secrets-touch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Без полей' }));
    await waitFor(() => expect(screen.getByText(/403 нет прав/)).toBeTruthy());
    expect(f.md() ?? '').not.toContain('[[ADR-LORE-050#');
    await f.settle();
  });

  it('пусто ≠ не загрузилось: «не нашлось» с «завести тег», отказ — «не смогли загрузить»', async () => {
    const f = await mount(source(tagSource()));
    await f.type('см. #xyz');
    await waitFor(() => expect(screen.getByText(/Тегов по «#xyz» не нашлось/)).toBeTruthy());
    expect(screen.getByRole('button', { name: /Завести тег «xyz»/ })).toBeTruthy();
    await f.settle();
    f.unmount();
    const g = await mount(source(tagSource({ search: vi.fn(async () => { throw new Error('503 от /lore/tag/suggest'); }) })));
    await g.type('см. #xyz');
    await waitFor(() => expect(screen.getByText(/Не смогли загрузить теги: 503/)).toBeTruthy());
    expect(screen.queryByText(/не нашлось/)).toBeNull();
    await g.settle();
  });

  it('без источника тегов «#слово» по-прежнему говорит «тип не знаем»; «#adr» — поиск записей', async () => {
    const f = await mount(source());
    await f.type('см. #xyz');
    await waitFor(() => expect(screen.getByText(/Тип «xyz» не знаем/)).toBeTruthy());
    await f.settle();
  });

  it('записи без своего ID (новая, ещё не сохранена) тег не ставится — окно говорит почему', async () => {
    const f = await mount(source(tagSource({ host: null })));
    await f.type('см. #sec');
    await waitFor(() => expect(screen.getByText(/Тег ставится сохранённой записи/)).toBeTruthy());
    await f.settle();
  });
});
