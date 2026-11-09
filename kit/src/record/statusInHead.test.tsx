// @vitest-environment jsdom
// Статус в записи меняется там, где он показан — если права позволяют
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG, дефект 09.11).
//
// ПОВОД — замечание владелицы: «не могу поменять статус адр через новый
// редиз». Разбор показал, что не хватало ДВУХ половин, и обе мои:
//
//   1. в приложении путь сохранения статуса был написан и не подключён;
//   2. **здесь:** в записи статус рисовался `StatusPill` — неинтерактивной
//      плашкой. То есть кнопки не существовало вовсе, и подключать её было
//      некуда. Моя же запись «чип стал нажимаемым, а сохранять было нечем»
//      оказалась неверной в первой половине.
//
// Почему это правка kit, а не приложения: «статус меняется, когда права
// позволяют» — форма, общая для любого приложения на конструкторе. Какие права
// у человека и куда уходит сохранение, решает приложение (`config.roles`,
// `hooks.onSave`); kit только выбирает между плашкой и кнопкой.
//
// Отдельно закрепляется обратное: без прав чип НЕ появляется. Кнопка, которая
// отказывает при нажатии, хуже её отсутствия.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordHead } from './RecordHead';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

const ICON = 'sprint';

const record: KitRecord = {
  id: 'ADR-LORE-049', kind: 'adr', title: 'Правила конвертации', status: 'proposed', fields: {},
};

function config(roles?: KitConfig['roles']): KitConfig {
  return {
    modules: [{ id: 'm', title: 'M', icon: ICON, status: 'active' }],
    menu: { groups: [] },
    kinds: { adr: { title: 'ADR', icon: ICON } },
    statuses: {
      items: [
        { code: 'proposed', title: 'Предложено', category: 'active', icon: ICON, color: 'var(--st-planned)' },
        { code: 'accepted', title: 'Принято', category: 'done', icon: ICON, color: 'var(--st-done)' },
        { code: 'draft', title: 'Черновик', category: 'todo', icon: ICON, color: 'var(--st-todo)' },
      ],
    },
    ...(roles ? { roles } : {}),
  } as KitConfig;
}

function ctxOf(cfg: KitConfig, role?: string, onSave?: (c: unknown) => Promise<void>): KitCtx {
  return {
    config: onSave ? { ...cfg, hooks: { ...cfg.hooks, onSave: onSave as never } } : cfg,
    data: { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-09T00:00:00Z' } },
    ...(role ? { role } : {}),
    href: (x: string) => `#${x}`,
    esc: (s: string) => s,
    md: (s: string) => s,
  } as KitCtx;
}

const head = (ctx: KitCtx) => render(<RecordHead record={record} ctx={ctx} lang="ru" titleId="t" />);

describe('статус в шапке записи: плашка или кнопка — по правам', () => {
  it('положительный контроль: шапка рисуется и показывает статус словом', () => {
    head(ctxOf(config({ reader: { canEdit: false, canStatus: false } }), 'reader'));
    expect(screen.getByText('Предложено')).toBeTruthy();
  });

  it('права на смену ЕСТЬ — статус становится кнопкой', () => {
    head(ctxOf(config({ reader: { canEdit: true, canStatus: true } }), 'reader'));
    expect(screen.getByRole('button', { name: /^Статус/ })).toBeTruthy();
  });

  it('прав НЕТ — кнопки нет вовсе, только плашка', () => {
    head(ctxOf(config({ reader: { canEdit: true, canStatus: false } }), 'reader'));
    expect(screen.queryByRole('button', { name: /^Статус/ })).toBeNull();
    // Статус при этом по-прежнему ВИДЕН: нет прав ≠ нет значения.
    expect(screen.getByText('Предложено')).toBeTruthy();
  });

  it('статусной оси нет вовсе (K-14) — кнопки нет, даже если права есть', () => {
    const cfg = config({ reader: { canEdit: true, canStatus: true } });
    head(ctxOf({ ...cfg, statuses: { items: [] } }, 'reader'));
    expect(screen.queryByRole('button', { name: /^Статус/ })).toBeNull();
  });

  it('нажатие уходит в hooks.onSave приложения — kit сам ничего не пишет', async () => {
    const onSave = vi.fn(async (_c: unknown) => {});
    const cfg = config({ reader: { canEdit: true, canStatus: true } });
    head(ctxOf(cfg, 'reader', onSave));
    const { fireEvent, act } = await import('@testing-library/react');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Статус/ })); });
    // Статус НЕзавершающий: он уходит сразу. Завершающий просит третий шаг —
    // отдельной проверкой ниже.
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Черновик/ })); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.lastCall?.[0]).toMatchObject({ field: 'status', from: 'proposed', to: 'draft' });
  });
});

describe('завершающий статус — третьим шагом (S4-07)', () => {
  it('переход в «готово» просит подтверждения, а не уходит сразу', async () => {
    const onSave = vi.fn(async () => {});
    const cfg = config({ reader: { canEdit: true, canStatus: true } });
    head(ctxOf(cfg, 'reader', onSave));
    const { fireEvent, act } = await import('@testing-library/react');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Статус/ })); });
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: /Принято/ })); });
    // Случайное «готово» дорого, поэтому один щелчок его не ставит.
    expect(onSave).not.toHaveBeenCalled();
  });
});
