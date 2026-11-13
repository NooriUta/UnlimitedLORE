// @vitest-environment jsdom
// MP2-08 (SPRINT_UXR_MOBILE_POLISH, владелица 13.11.2026): технические
// сообщения убраны из компоновки и собраны под ОДИН значок warnings с
// попапом; сообщения нескольких источников агрегируются в один список.
//
// Что держат эти тесты:
//   1. Источников несколько — значок один, число суммарное, в поповере все
//      строки, сгруппированные по источнику.
//   2. Сообщений нет — значка нет (пустой значок обещал бы предупреждение).
//   3. Паспорт со сборщиком НЕ рисует блок «Состояние данных» в потоке;
//      без сборщика (витрина kit) блок остаётся — молчать о неполноте нельзя.
//   4. Источник ушёл (запись закрыта/перерисована) — его строки ушли из списка.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));

import { RecordView } from './RecordView';
import { RecordBar } from './RecordReader';
import { TechVisibilityProvider } from '../resilience/techGate';
import { WarningsProvider, useWarningsSource, type WarningItem } from './warnings';
import type { KitCtx, KitMeta, KitRecord } from '../core/contract';

const record: KitRecord = { id: 'ADR-1', kind: 'Adr', title: 'Запись', status: 'todo', fields: {} };

const ctxWith = (meta: KitMeta): KitCtx => ({
  data: { records: [record], edges: [], journal: [], meta },
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: { Adr: { title: 'ADR', icon: 'scroll-quill', fields: [] } },
  },
  href: id => `#${id}`,
  esc: s => s,
  md: s => <span>{s}</span>,
});

const item = (source: string, text: string): WarningItem => ({ source, label: 'не смогли проверить', text, tone: 'dng' });

function Src({ k, items }: { k: string; items: WarningItem[] }) {
  useWarningsSource(k, items);
  return null;
}

describe('MP2-08 · один значок warnings на все технические сообщения', () => {
  it('несколько источников — один значок с суммарным числом и все строки в поповере', () => {
    render(
      <WarningsProvider>
        <Src k="data" items={[item('links', 'таймаут базы'), item('journal', 'нет прав')]} />
        <Src k="model" items={[{ source: 'оговорки модели', label: 'оговорки модели', text: 'порядок клиентский', tone: 'wrn' }]} />
        <RecordBar />
      </WarningsProvider>,
    );
    const triggers = screen.getAllByTestId('kit-rec-warnings');
    expect(triggers, 'значок ровно один').toHaveLength(1);
    expect(triggers[0].textContent).toContain('3');
    fireEvent.click(triggers[0].querySelector('button')!);
    const pop = document.querySelector('.sk-warn__pop')!;
    expect(pop).toBeTruthy();
    expect(pop.textContent).toContain('таймаут базы');
    expect(pop.textContent).toContain('нет прав');
    expect(pop.textContent).toContain('порядок клиентский');
    // S4-TECH-NOTES: без настройки коды источников скрыты — список один,
    // человеческий; агрегация при этом не теряется (все три строки на месте).
    expect(pop.querySelectorAll('.sk-warn__group').length).toBe(1);
    expect(pop.textContent).not.toContain('links');
  });

  it('с включённой настройкой «технические сведения» — группировка по источникам с кодами', () => {
    render(
      <TechVisibilityProvider show>
        <WarningsProvider>
          <Src k="data" items={[item('links', 'таймаут базы'), item('journal', 'нет прав')]} />
          <Src k="model" items={[{ source: 'оговорки модели', label: 'оговорки модели', text: 'порядок клиентский', tone: 'wrn' }]} />
          <RecordBar />
        </WarningsProvider>
      </TechVisibilityProvider>,
    );
    fireEvent.click(screen.getByTestId('kit-rec-warnings').querySelector('button')!);
    const pop = document.querySelector('.sk-warn__pop')!;
    expect(pop.querySelectorAll('.sk-warn__group').length, 'группы по источникам').toBe(3);
    expect(pop.textContent).toContain('links');
    expect(pop.textContent).toContain('journal');
  });

  it('сообщений нет — значка нет', () => {
    render(<WarningsProvider><Src k="data" items={[]} /><RecordBar /></WarningsProvider>);
    expect(screen.queryByTestId('kit-rec-warnings')).toBeNull();
  });

  it('источник ушёл — его строки ушли из списка, чужие остались', () => {
    const Two = () => (
      <WarningsProvider>
        <Src k="data" items={[item('links', 'таймаут базы')]} />
        <Src k="model" items={[{ source: 'модель', label: 'модель', text: 'оговорка', tone: 'wrn' }]} />
        <RecordBar />
      </WarningsProvider>
    );
    const { rerender } = render(<Two />);
    expect(screen.getByTestId('kit-rec-warnings').textContent).toContain('2');
    const One = () => (
      <WarningsProvider>
        <Src k="model" items={[{ source: 'модель', label: 'модель', text: 'оговорка', tone: 'wrn' }]} />
        <RecordBar />
      </WarningsProvider>
    );
    rerender(<One />);
    expect(screen.getByTestId('kit-rec-warnings').textContent).toContain('1');
    fireEvent.click(screen.getByTestId('kit-rec-warnings').querySelector('button')!);
    expect(document.querySelector('.sk-warn__pop')!.textContent).not.toContain('таймаут базы');
  });

  it('паспорт со сборщиком: блока «Состояние данных» в потоке нет, строки — в значке', () => {
    const meta = { generated_at: '2026-11-13T00:00:00Z', errors: [{ block: 'links', reason: 'таймаут базы' }] } as KitMeta;
    render(
      <WarningsProvider>
        <RecordBar />
        <RecordView record={record} ctx={ctxWith(meta)} tab="overview" onTab={() => {}} />
      </WarningsProvider>,
    );
    expect(document.querySelector('.sk-ds'), 'inline-блок убран из компоновки').toBeNull();
    const trig = screen.getByTestId('kit-rec-warnings');
    expect(trig.textContent).toContain('1');
    fireEvent.click(trig.querySelector('button')!);
    expect(document.querySelector('.sk-warn__pop')!.textContent).toContain('таймаут базы');
  });

  it('без сборщика паспорт не молчит: прежний блок состояния данных на месте', () => {
    const meta = { generated_at: '2026-11-13T00:00:00Z', errors: [{ block: 'links', reason: 'таймаут базы' }] } as KitMeta;
    render(<RecordView record={record} ctx={ctxWith(meta)} tab="overview" onTab={() => {}} />);
    expect(document.querySelector('.sk-ds')).toBeTruthy();
    expect(document.querySelector('.sk-ds')!.textContent).toContain('таймаут базы');
  });
});
