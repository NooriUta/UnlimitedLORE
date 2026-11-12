// @vitest-environment jsdom
// Владелица 11.11.2026: «в паспорте в дочерних табличных видах не подтягиваются правильные
// иконки, привязанные к статусам». Сквозная проверка: модель с циклами компонента и задачи →
// паспорт компонента → вкладка «Задачи» таблицей → у строки задачи иконка ЦИКЛА ЗАДАЧИ.
// Иконки не регистрируются: GameIcon без набора рисует заглушку data-missing = слаг.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TechVisibilityProvider } from '@seidr/kit';
import ListPassport from './ListPassport';

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => window.history.replaceState(null, '', '/'));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FACADE = {
  contract: 'lore.record/1',
  record: { type: 'component', id: 'SP', title: 'Компонент SP', status: 'active', version: 'v1' },
  values: { title: 'Компонент SP' },
  parts: [],
  links: [{ rel: 'IMPLEMENTS', dir: 'in', id: 'SP/A-1', type: 'task', title: 'Задача А', status: 'review' }],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  schema: {
    type: 'component', label: 'Компонент', label_key: 'rec.component', icon: 'calendar',
    fields: [{ key: 'title', label: 'Название', label_key: 'f.t', kind: 'text', group: 'head', required: true, editable: false, write: null }],
    layout: {}, relations: [{ key: 'tasks', label: 'Задачи', relation: 'association', rel: 'IMPLEMENTS', dir: 'in', target_type: 'task', place: 'link_tab', manageable: false }],
  },
  meta: { facade: 'server', sources: {}, data_state: [] },
};

const MODEL = {
  format: 'model/0', version: '2026-11-11T00:00:00Z',
  statuses: {
    component: { entries: [{ code: 'active', title: 'Идёт', category: 'in_progress', icon: 'run', color: 'var(--inf)' }] },
    task: { entries: [{ code: 'review', title: 'На проверке', category: 'in_progress', icon: 'magnifying-glass', color: 'var(--wrn)' }] },
  },
};

const net = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input), 'http://lore.test');
  if (url.pathname.startsWith('/lore/record/')) return json(FACADE);
  if (url.pathname === '/lore/model') return json(MODEL);
  if (url.pathname === '/lore/history') return json({ type: 'component', id: 'SP', rows: [], attribution: { ok: true } });
  if (url.pathname === '/lore/me/drafts') return json({ drafts: [] });
  return json({ rows: [] });
}) as unknown as typeof fetch;

describe('паспорт компонента: статус строки задачи — по циклу задачи', () => {
  it('у задачи в «На проверке» — иконка и подпись задачи, а не «неизвестно»', async () => {
    render(
      <TechVisibilityProvider show={false}>
        <ListPassport type="component" id="SP" placement="bottom" fetchImpl={net} backLabel="Компоненты" onBack={() => {}} />
      </TechVisibilityProvider>,
    );
    fireEvent.click(await screen.findByRole('tab', { name: /Зависимости/ }, { timeout: 8000 }));
    await waitFor(() => {
      const st = document.querySelector('[data-status="review"]');
      expect(st?.querySelector('[data-missing]')?.getAttribute('data-missing')).toBe('magnifying-glass');
      expect(st?.textContent).toContain('На проверке');
    }, { timeout: 8000 });
  }, 15000);
});
