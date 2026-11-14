// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P1: «Сворачивание свойств в доке: панель
// постоянная; в полноэкранном демо — сворачиваемая строка "▸ Свойства" —
// одно поведение на два режима».
//
// Было так: снизу свойства — колонка справа (свернуть нельзя), во весь экран —
// свёртка под шапкой. Одна и та же запись вела себя двумя способами, и «можно
// ли убрать свойства» зависело от того, как её открыли.
//
// Делаем одно поведение: свойства сворачиваются везде, где они зоной. В доке
// панель по умолчанию раскрыта (как было до правки — ничего не прячем молча),
// во весь экран — свёрнута (как было). Состояние — тот же propsOpen, что уже
// умеет управляться приложением (S4-30), поэтому настройка «Свойства открыты
// или свёрнуты» теперь действует и в доке.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { spec: { title: 'Спека', icon: 'scroll-quill', fields: [{ key: 'version', title: 'Версия', type: 'text' }] } },
  statuses: { items: [{ code: 'proposed', title: 'предложено', category: 'in_progress', icon: 'calendar', color: 'var(--acc)' }] },
};
const record: KitRecord = { id: 'S-1', kind: 'spec', title: 'Спека', status: 'proposed', fields: { version: '1.0' }, body_md: 'Текст' };
const ctx: KitCtx = {
  config, data: { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } },
  href: id => `#${id}`, esc: s => s, md: s => s,
};

const view = (extra: Partial<Parameters<typeof RecordView>[0]> = {}) =>
  render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} placement="bottom" {...extra} />);

const aside = () => document.querySelector('[data-zone="props"]');
// S4-29: «Свойства» есть и у значка вида в строке статуса — свёртка зоны отличается тем, что не в группе вида.
const fold = () => screen.getAllByRole('button', { name: /Свойства/ }).find(b => !b.closest('[role="group"]'))!;

describe('свойства сворачиваются и в доке', () => {
  it('положительный контроль: в доке свойства раскрыты и значение видно', () => {
    view();
    expect(aside()).toBeTruthy();
    expect(screen.getByText('1.0')).toBeTruthy();
  });

  it('заголовок зоны — кнопка свёртки с честным aria-expanded', () => {
    view();
    expect(fold().getAttribute('aria-expanded')).toBe('true');
  });

  it('щелчок убирает колонку свойств', () => {
    view();
    fireEvent.click(fold());
    expect(aside()).toBeNull();
    // Свойства не исчезли из записи — свёрнуты в строку, которую видно.
    expect(screen.getByText(/Свойства/)).toBeTruthy();
  });

  it('свёрнутую строку можно раскрыть обратно — тупика нет', () => {
    view();
    fireEvent.click(fold());
    const row = document.querySelector('.sk-rec-propsrow') as HTMLDetailsElement;
    expect(row).toBeTruthy();
    // jsdom не раскрывает <details> по щелчку в summary (это поведение
    // браузера, а не DOM), поэтому делаем то же, что сделал бы браузер:
    // ставим open и отдаём событие toggle. Проверяется наш обработчик.
    row.open = true;
    fireEvent(row, new Event('toggle', { bubbles: false }));
    expect(aside()).toBeTruthy();
  });

  it('во весь экран по умолчанию свёрнуто — как было до правки', () => {
    view({ placement: 'full' });
    const row = document.querySelector('.sk-rec-propsrow') as HTMLDetailsElement;
    expect(row.open).toBe(false);
  });

  it('управляемый режим: решение приложения главнее, вид сам не меняется', () => {
    const onPropsOpenChange = vi.fn();
    view({ propsOpen: true, onPropsOpenChange });
    fireEvent.click(fold());
    expect(onPropsOpenChange).toHaveBeenCalledWith(false);
    expect(aside(), 'приложение ещё не ответило — панель на месте').toBeTruthy();
  });

  it('у кнопки свёртки есть своё правило в seidr.css (один слой, S4-00e)', () => {
    expect(css).toMatch(/\.sk-rec__zone--fold\s*\{/);
  });
});
