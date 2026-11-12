// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30 — блок «Состояние данных», отрисовка.
//
// Разбор лежит в dataState.ts; здесь — как он показывается. Главное правило
// то же: «не смогли проверить» ≠ «пусто», поэтому у трёх состояний разный
// вид, а не одна общая серая строка.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { TechVisibilityProvider } from '../resilience/techGate';
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

// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-TECH-NOTES: строки с тегом audience=tech
// (тег ставит тот, кто рождает сообщение, — сервер или приложение) скрыты,
// пока их не включили. Факт неполноты остаётся одной строкой без кодов.
describe('S4-TECH-NOTES · технические строки «Состояния данных»', () => {
  const techMeta = { generated_at: 'x', data_state: [
    { source: 'relation:deps', state: 'error', reason: 'HTTP 500', audience: 'tech' },
    { source: 'chips:inherited', state: 'ok', audience: 'tech' },
  ] } as never;

  it('по умолчанию кодов нет, но неполнота сказана словами', () => {
    render(<DataStateBlock meta={techMeta} />);
    const box = screen.getByRole('region', { name: /Состояние данных/i });
    expect(box.textContent).not.toContain('relation:deps');
    expect(box.textContent).not.toContain('HTTP 500');
    expect(box.textContent).not.toContain('chips:inherited');
    expect(screen.getByTestId('ds-tech-hidden').textContent).toMatch(/часть сведений не загрузилась/i);
  });

  it('кнопка «тех.» на месте раскрывает диагностику', () => {
    render(<DataStateBlock meta={techMeta} />);
    fireEvent.click(screen.getByRole('button', { name: /техническ/i }));
    expect(screen.getByTestId('ds-failed').textContent).toContain('relation:deps');
  });

  it('кнопка подписана «тех. данных» — отличима от чипа «тех. модели» оговорок', () => {
    render(<DataStateBlock meta={techMeta} />);
    const btn = screen.getByRole('button', { name: /техническ/i });
    expect(btn.textContent).toBe('тех. данных');
  });

  it('включённая настройка показывает всё прежнее на своих местах', () => {
    render(<TechVisibilityProvider show><DataStateBlock meta={techMeta} /></TechVisibilityProvider>);
    expect(screen.getByTestId('ds-failed').textContent).toContain('HTTP 500');
    expect(screen.getByTestId('ds-checked').textContent).toContain('chips:inherited');
    expect(screen.queryByTestId('ds-tech-hidden')).toBeNull();
  });

  it('только проверенное tech — пользователю сказать нечего, блока нет', () => {
    const { container } = render(<DataStateBlock meta={{ generated_at: 'x', data_state: [
      { source: 'chips:inherited', state: 'ok', audience: 'tech' },
    ] } as never} />);
    expect(container.firstChild).toBeNull();
  });

  it('«показано N из M» и строки без тега остаются видны', () => {
    render(<DataStateBlock meta={{ generated_at: 'x', truncated: true, returned: 100, total: 230,
      errors: [{ block: 'relation:deps', reason: 'HTTP 500', audience: 'tech' }, { block: 'edges', reason: 'нет связи' }] } as never} />);
    expect(screen.getByTestId('ds-truncated').textContent).toMatch(/100.*230/);
    expect(screen.getByTestId('ds-failed').textContent).toContain('edges');
    expect(screen.getByTestId('ds-failed').textContent).not.toContain('relation:deps');
  });
});

describe('S4-TECH-NOTES · без задвоения между адресатами', () => {
  it('ошибка в errors без тега, уже сказанная tech-строкой data_state, в пользовательскую часть не всплывает', () => {
    render(<DataStateBlock meta={{ generated_at: 'x',
      data_state: [{ source: 'relation:deps', state: 'error', reason: 'HTTP 500', audience: 'tech' }],
      errors: [{ block: 'relation:deps', reason: 'HTTP 500' }] } as never} />);
    expect(screen.queryByTestId('ds-failed')).toBeNull();
    expect(screen.getByTestId('ds-tech-hidden').textContent).toMatch(/не загрузилась/);
  });
});
