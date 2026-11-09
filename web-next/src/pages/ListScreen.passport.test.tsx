// @vitest-environment jsdom
// Паспорта из живых списков v2 (просьба владелицы 08.11: «подключить паспорта как есть»).
// До этого заголовок строки общего ListScreen вёл в никуда (href по умолчанию «#id»),
// а новые паспорта kit (S4-33, RecordDock + RecordView через lore.record/1) жили только
// в демо /kit/passport. Теперь щелчок по записи открывает её паспорт поверх списка;
// место (справа / снизу / весь экран) переключается, «Закрыть» возвращает к списку.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitShell, registerGameIcons, type KitConfig } from '@seidr/kit';
import { ListScreen } from './ListScreen';

beforeAll(() => { registerGameIcons(gameIcons); });

const jsonRes = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function fakeFetch() {
  return vi.fn(async (input: RequestInfo | URL) => {
    const slice = new URL(String(input), 'http://lore.test').pathname.split('/').pop();
    if (slice === 'sprints') return jsonRes({ rows: [{ sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS', context_md: '## Цель SP' }] });
    if (slice === 'tasks_of_sprints_batch' || slice === 'tasks_of_sprint') {
      return jsonRes({ rows: [{ task_uid: 'SP/T1', task_id: 'T1', title: 'Задача T1', status_raw: '✅ DONE', sprint_id: 'SP', order_index: 1 }] });
    }
    return jsonRes({ rows: [] });
  }) as unknown as typeof fetch;
}

describe('паспорт записи открывается из живого списка', () => {
  it('щелчок по спринту — паспорт поверх списка; место меняется; «Закрыть» убирает паспорт', async () => {
    const { container } = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={false} />);
    const title = await screen.findByRole('button', { name: 'Спринт SP' });
    fireEvent.click(title);
    const dock = await waitFor(() => {
      const d = container.querySelector('[data-testid="kit-rec-dock"]');
      if (!d) throw new Error('паспорт не открыт');
      return d;
    });
    expect(dock.getAttribute('data-placement')).toBe('right');
    await waitFor(() => expect(container.querySelector('[data-testid="kit-rec-dock"] article[data-kind]')).toBeTruthy(), { timeout: 8000 }); // ленивый чанк MartProse/mermaid
    // S4-CONTENT-V4 п.1 (прототип v4): строка над записью — крошки «← Спринты / ID» и листалка по списку.
    const bar = container.querySelector('[data-testid="kit-rec-dock"] [data-testid="kit-rec-bar"]');
    expect(bar, 'строка крошек над паспортом').toBeTruthy();
    expect(bar!.textContent).toContain('Спринты');
    expect(bar!.querySelector('[data-testid="kit-rec-pager"]')).toBeTruthy();
    // Место — в «Вид» списка (08.11), а не полосой над паспортом.
    expect(container.querySelector('[data-testid="list-passport-bar"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Вид/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Паспорт открывается' })).getByRole('radio', { name: 'на весь экран' }));
    expect(container.querySelector('[data-testid="kit-rec-dock"]')!.getAttribute('data-placement')).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть паспорт' }));
    expect(container.querySelector('[data-testid="kit-rec-dock"]')).toBeNull();
    // Бюджет теста 15 с — больше, чем ожидание ленивого чанка внутри (8 с).
    // С умолчанием в 5 с тест не мог дождаться собственного waitFor и падал
    // под нагрузкой: он монтирует весь ListScreen и ждёт MartProse/mermaid.
    // Проверено двумя сессиями: в одиночку проходит, красный только в полном
    // прогоне. «Flaky» не называем — для этого нужно ≥10 прогонов со счётом.
  }, 15000);
});

describe('S4-02 · личные настройки записи доходят до экрана (CJM прод 09.11.2026)', () => {
  // До этой правки выбор «Правая колонка записи» и «Меню при чтении записи»
  // ложился атрибутами на корень документа, которых НЕ читал никто: настройка
  // сохранялась и ничего не делала, а в панели рядом стоял второй, тоже
  // мёртвый блок про то же. Владелица видела «две правды».
  const attr = (name: string, value: string | null) => {
    if (value === null) document.documentElement.removeAttribute(name);
    else document.documentElement.setAttribute(name, value);
  };
  afterEach(() => { attr('data-right-column', null); attr('data-read-nav', null); });

  const openPassport = async () => {
    const r = render(<ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={false} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(
      () => expect(r.container.querySelector('[data-testid="kit-rec-dock"] article[data-kind]')).toBeTruthy(),
      { timeout: 8000 },
    );
    return r;
  };

  /** Снизу свойства — КОЛОНКА: только там выбор «открыта/свёрнута» и виден. */
  const toBottom = () => {
    fireEvent.click(screen.getByRole('button', { name: /^Вид/ }));
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Паспорт открывается' })).getByRole('radio', { name: 'снизу' }));
  };

  it('положительный контроль: «открыта» — колонка свойств раскрыта', async () => {
    attr('data-right-column', 'open');
    const { container } = await openPassport();
    toBottom();
    await waitFor(() => expect(container.querySelector('aside[data-zone="props"]')).toBeTruthy());
  }, 15000);

  it('«свёрнута» — колонки нет, свойства строкой-свёрткой', async () => {
    attr('data-right-column', 'closed');
    const { container } = await openPassport();
    toBottom();
    await waitFor(() => expect(container.querySelector('.sk-rec-propsrow')).toBeTruthy());
    expect(container.querySelector('aside[data-zone="props"]')).toBeNull();
  }, 15000);

  it('«не сворачивать» — меню оболочки экран не трогает', async () => {
    // Положительный контроль обратной стороны: без выбора человека экран не
    // должен убирать меню сам.
    attr('data-read-nav', null);
    const { container } = await openPassport();
    expect(container.querySelector('.sk-shell--menu-collapsed')).toBeNull();
  }, 15000);
});

describe('S4-02 · «сворачивать меню при чтении» — положительный контроль в оболочке', () => {
  // Отрицательный контроль (экран не трогает меню сам) есть выше. Без этого
  // теста правка оставалась бы недоказанной: сам по себе ListScreen оболочки
  // не видит, и «ничего не произошло» выглядело бы как успех.
  const SHELL_CONFIG: KitConfig = {
    modules: [{ id: 'lore', title: 'LORE', icon: 'scroll-unfurled', status: 'active' }],
    menu: { groups: [{ id: 'work', title: 'Работа', items: [{ id: 'sprints', title: 'Спринты', view: 'list' }] }] },
    kinds: { sprint: { title: 'Спринт', icon: 'sprint' } },
    statuses: { items: [{ code: 'done', title: 'Готово', category: 'done', icon: 'check-mark', color: 'var(--suc)' }] },
  };
  const win = () => ({ location: { pathname: '/', search: '', hash: '' }, history: { pushState: () => {}, replaceState: () => {} } });

  afterEach(() => { document.documentElement.removeAttribute('data-read-nav'); });

  it('меню убрано, пока открыта запись, и возвращается после закрытия', async () => {
    document.documentElement.setAttribute('data-read-nav', 'collapse');
    const { container } = render(
      <KitShell config={SHELL_CONFIG} win={win()} narrow={false}>
        <ListScreen screen="sprints" fetchImpl={fakeFetch()} urlState={false} />
      </KitShell>,
    );
    expect(container.querySelector('.sk-shell--menu-collapsed')).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Спринт SP' }));
    await waitFor(() => expect(container.querySelector('.sk-shell--menu-collapsed')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть паспорт' }));
    await waitFor(() => expect(container.querySelector('.sk-shell--menu-collapsed')).toBeNull());
  }, 15000);
});
