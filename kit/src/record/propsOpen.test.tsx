// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30 — настройка «колонка „Свойства“ по
// умолчанию открыта или свёрнута».
//
// В режиме «на весь экран» свойства показываются свёрнутой строкой под
// шапкой (как в прототипе v4). До сих пор она всегда стартовала свёрнутой —
// жёстко, без выбора. Владелица просила это настройкой.
//
// Образец тот же, что у графика burn-down в kit: неуправляемый режим с
// умолчанием плюс управляемый, когда приложение хранит выбор у себя. kit
// сам ничего не хранит — где лежит настройка, решает приложение.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));

import { RecordView } from './RecordView';
import type { KitCtx, KitRecord } from '../core/contract';

const record: KitRecord = {
  id: 'ADR-1', kind: 'Adr', title: 'Запись', status: 'todo',
  fields: { priority: 'P1', owner: 'claude' },
};

const ctx: KitCtx = {
  data: { records: [record], edges: [], journal: [], meta: { generated_at: 'x' } },
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: {
      Adr: {
        title: 'ADR', icon: 'scroll-quill',
        fields: [
          { key: 'priority', title: 'Приоритет', type: 'enum' },
          { key: 'owner', title: 'Ответственный', type: 'text' },
        ],
      },
    },
  },
  href: id => `#${id}`,
  esc: s => s,
  md: s => <span>{s}</span>,
};

const row = () => document.querySelector('.sk-rec-propsrow') as HTMLDetailsElement | null;

function show(extra: Record<string, unknown> = {}) {
  return render(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} placement="full" {...extra} />);
}

describe('S4-30 · «Свойства» открыты или свёрнуты', () => {
  it('по умолчанию свёрнуты — прежнее поведение сохранено', () => {
    show();
    expect(row()).toBeTruthy();
    expect(row()?.open).toBe(false);
  });

  it('настройка «открыта» — строка раскрыта с первого показа', () => {
    show({ defaultPropsOpen: true });
    expect(row()?.open).toBe(true);
  });

  it('управляемый режим: состояние задаёт приложение', () => {
    show({ propsOpen: true });
    expect(row()?.open).toBe(true);
  });

  it('переключение отдаётся наружу — хранит приложение, не kit', () => {
    const onPropsOpenChange = vi.fn();
    show({ propsOpen: false, onPropsOpenChange });
    const el = row()!;
    el.open = true;
    fireEvent(el, new Event('toggle'));
    expect(onPropsOpenChange).toHaveBeenCalledWith(true);
  });

  it('в управляемом режиме kit не решает сам: пока приложение не ответило, состояние прежнее', () => {
    const { rerender } = show({ propsOpen: false, onPropsOpenChange: () => {} });
    const el = row()!;
    el.open = true;
    fireEvent(el, new Event('toggle'));
    rerender(<RecordView record={record} ctx={ctx} tab="overview" onTab={() => {}} placement="full" propsOpen={false} onPropsOpenChange={() => {}} />);
    expect(row()?.open).toBe(false);
  });
});
