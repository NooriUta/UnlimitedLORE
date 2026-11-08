// @vitest-environment jsdom
// Паспорта из живых списков v2 (просьба владелицы 08.11: «подключить паспорта как есть»).
// До этого заголовок строки общего ListScreen вёл в никуда (href по умолчанию «#id»),
// а новые паспорта kit (S4-33, RecordDock + RecordView через lore.record/1) жили только
// в демо /kit/passport. Теперь щелчок по записи открывает её паспорт поверх списка;
// место (справа / снизу / весь экран) переключается, «Закрыть» возвращает к списку.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
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
    fireEvent.click(screen.getByRole('button', { name: /весь экран/i }));
    expect(container.querySelector('[data-testid="kit-rec-dock"]')!.getAttribute('data-placement')).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть паспорт' }));
    expect(container.querySelector('[data-testid="kit-rec-dock"]')).toBeNull();
  });
});
