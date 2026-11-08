// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30 — блок «Состояние данных», отрисовка.
//
// Разбор лежит в dataState.ts; здесь — как он показывается. Главное правило
// то же: «не смогли проверить» ≠ «пусто», поэтому у трёх состояний разный
// вид, а не одна общая серая строка.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axeViolations } from '../test/axe';
import { DataStateBlock } from './DataStateBlock';

describe('S4-30 · блок «Состояние данных»', () => {
  it('сказать нечего — блока нет вовсе, а не пустая рамка', () => {
    const { container } = render(<DataStateBlock meta={{ generated_at: 'x', total: 3, returned: 3 }} />);
    expect(container.firstChild).toBeNull();
  });

  it('непрочитанный блок виден с названием и причиной', () => {
    render(<DataStateBlock meta={{ generated_at: 'x', errors: [{ block: 'edges', reason: 'HTTP 403' }] }} />);
    const failed = screen.getByTestId('ds-failed');
    expect(failed.textContent).toContain('edges');
    expect(failed.textContent).toContain('HTTP 403');
  });

  it('обрезанная выдача показывает, сколько из скольких', () => {
    render(<DataStateBlock meta={{ generated_at: 'x', truncated: true, returned: 100, total: 500 }} />);
    expect(screen.getByTestId('ds-truncated').textContent).toMatch(/100.*500/);
  });

  it('обрезано, а сколько всего неизвестно — не придумываем «из N»', () => {
    render(<DataStateBlock meta={{ generated_at: 'x', truncated: true, returned: 100 }} />);
    const t = screen.getByTestId('ds-truncated').textContent ?? '';
    expect(t).toContain('100');
    expect(t).not.toMatch(/из\s*\d/);
  });

  it('проверенные блоки перечислены отдельно от непрочитанных', () => {
    render(<DataStateBlock meta={{ generated_at: 'x', data_state: [
      { block: 'tasks', state: 'ok' },
      { block: 'edges', state: 'error', reason: 'таймаут' },
    ] } as never} />);
    expect(within(screen.getByTestId('ds-checked')).getByText(/tasks/)).toBeTruthy();
    expect(within(screen.getByTestId('ds-failed')).getByText(/edges/)).toBeTruthy();
    // Проверенное не попадает в непрочитанное и наоборот.
    expect(screen.getByTestId('ds-checked').textContent).not.toContain('edges');
  });

  it('у блока есть заголовок — его видно в структуре страницы', () => {
    render(<DataStateBlock meta={{ generated_at: 'x', errors: [{ block: 'edges', reason: 'x' }] }} />);
    expect(screen.getByRole('heading', { name: /Состояние данных/i })).toBeTruthy();
  });

  it('доступность: нарушений axe нет', async () => {
    const { container } = render(<DataStateBlock meta={{ generated_at: 'x', truncated: true, returned: 10, total: 99, errors: [{ block: 'edges', reason: 'HTTP 403' }] }} />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
