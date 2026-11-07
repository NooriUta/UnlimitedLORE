// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-11 · связка целиком: паспорт v2 = RecordView
// kit + useRecordHistory. Вкладка «История» → выбрать старую версию → «Вернуть
// как новую версию» → «Вернуть» → POST в write-API → история перечитана.
import { beforeAll, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, RecordView, registerGameIcons, type KitCtx, type KitRecord } from '@seidr/kit';
import { useRecordHistory } from './useRecordHistory';
import type { FetchLike } from './recordHistory';

beforeAll(() => registerGameIcons(gameIcons));

const REC: KitRecord = { id: 'SPRINT_X/T-1', kind: 'Task', title: 'Задача', status: 'IN_PROGRESS', fields: {} };
const ctx: KitCtx = {
  data: { records: [REC], edges: [], journal: [], meta: { generated_at: '2026-11-07T12:00:00Z' } },
  config: { modules: [], menu: { groups: [] }, kinds: { Task: { title: 'Задачи', icon: 'scroll-quill' } }, statuses: { items: [] } },
  href: id => `?section=tasks&passport=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div>,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const author = { kind: 'human', kc_sub: 'u-1', display_name: 'Маша' };

function Passport({ fetchImpl }: { fetchImpl: FetchLike }) {
  const history = useRecordHistory('task', REC.id, { title: REC.title, fetchImpl });
  return <RecordView record={REC} ctx={ctx} tab="history" onTab={() => {}} history={history} />;
}

describe('S5-11 · вкладка «История» в паспорте v2', () => {
  it('выбрать старую версию и вернуть её как новую — POST /lore/task/edit, затем перечитывание', async () => {
    const posts: unknown[] = [];
    let reads = 0;
    const fetchImpl: FetchLike = async (url, init) => {
      if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return json(200, { ok: true }); }
      reads++;
      const v = (uid: string, from: string, open: boolean, note: string) => ({
        state_uid: uid, valid_from: from, valid_to: open ? null : '2026-11-07T10:00:00Z', is_open: open, status: 'TODO',
        fields: { note_md: note }, changed: ['note_md'], author,
      });
      const versions = reads === 1
        ? [v('s2', '2026-11-07T10:00:00Z', true, 'новая'), v('s1', '2026-11-06T10:00:00Z', false, 'старая')]
        : [v('s3', '2026-11-07T11:00:00Z', true, 'старая'), v('s2', '2026-11-07T10:00:00Z', false, 'новая'), v('s1', '2026-11-06T10:00:00Z', false, 'старая')];
      return json(200, { target: { type: 'task', id: REC.id, title: REC.title }, tracking: 'scd2', hist_type: 'KnowTaskHist',
        versions, anomalies: [], page: null, scope: null, outside_scope: null, warnings: [] });
    };

    render(<KitLangProvider lang="ru"><Passport fetchImpl={fetchImpl} /></KitLangProvider>);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(2));
    expect(screen.getByRole('tab', { name: /История/ }).textContent).toContain('2');

    fireEvent.click(screen.getAllByRole('button', { name: /Выбрать версию/ })[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть как новую версию' }));
    await act(async () => { fireEvent.click(within(screen.getByTestId('kit-history-confirm')).getByRole('button', { name: 'Вернуть' })); });

    expect(posts).toEqual([{ url: '/lore/task/edit', body: { task_uid: REC.id, title: 'Задача', note_md: 'старая' } }]);
    await waitFor(() => expect(screen.getAllByTestId('kit-history-row')).toHaveLength(3));
  });
});
