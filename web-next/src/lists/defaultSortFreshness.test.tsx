// @vitest-environment jsdom
// D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-04):
// «все ленты, где есть время актуальности записи или прочее, не по мере
// заведения, а по свежести по умолчанию в сортировку выводи».
//
// Правило проверяется на ВСЕХ разделах сразу, а не на перечне: раздел, чей
// маппер даёт записи время (updated_at), обязан по умолчанию идти по нему
// убыванием; раздел без времени — без умолчания (поле не выдумываем). Новый
// раздел с временем и без умолчания тест уронит.
import { beforeAll, describe, expect, it } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons, sortKeysOf } from '@seidr/kit';
import type { UrlWindow } from '@seidr/kit';
import { LIST_SCREENS, type ListScreenId } from './screens';
import { ListScreen } from '../pages/ListScreen';
import { loreTeamViews } from '../views/loreViews';

beforeAll(() => { registerGameIcons(gameIcons); });

/** Строка «всё сразу»: все ключи и все столбцы времени, какие отдают срезы. */
const SINK: Record<string, unknown> = {
  sprint_id: 'X', adr_id: 'X', task_uid: 'X', decision_id: 'X', spec_id: 'X', question_id: 'X',
  milestone_id: 'X', release_uid: 'X', release_id: 'X', component_id: 'X', tech_id: 'X', uc_id: 'X',
  valid_from: '2026-11-01', created_date: '2026-11-01', date_created: '2026-11-01', opened_date: '2026-11-01',
  release_date: '2026-11-01', checked_at: '2026-11-01', updated_at: '2026-11-01', shipped_at: '2026-11-01',
  // Время последнего изменения записи (вопрос №49: «по последней дате изменения — это свежесть»).
  changed_at: '2026-11-01T10:00:00.000Z',
};

const ids = Object.keys(LIST_SCREENS) as ListScreenId[];

describe('умолчание порядка — по свежести (D-2026-UXR-LISTS-DEFAULT-SORT-FRESHNESS)', () => {
  it.each(ids)('%s: есть время записи → порядок по умолчанию updated_at по убыванию; нет — умолчания нет', id => {
    const def = LIST_SCREENS[id] as (typeof LIST_SCREENS)[ListScreenId] & { defaultSort?: { key: string; dir: string } };
    const hasFresh = def.map(SINK).updated_at !== undefined;
    if (hasFresh) {
      expect(def.defaultSort, `${id}: время есть, умолчания порядка нет`).toEqual({ key: 'updated_at', dir: 'desc' });
      expect(sortKeysOf(def.config('ru')), `${id}: поле свежести — сортируемый ключ`).toContain(def.defaultSort!.key);
    } else {
      expect(def.defaultSort, `${id}: времени нет — умолчание выдумано`).toBeUndefined();
    }
  });

  it('командные виды разделов согласованы с умолчанием: порядок — свежесть по убыванию', () => {
    for (const v of loreTeamViews('ru')) {
      expect(new URLSearchParams(v.query).get('ls'), v.id).toBe('-updated_at');
    }
  });
});

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const adrs = [
  { adr_id: 'ADR-OLD', name: 'Альфа', status: 'accepted', date_created: '2026-01-01' },
  { adr_id: 'ADR-NEW', name: 'Гамма', status: 'accepted', date_created: '2026-11-01' },
  { adr_id: 'ADR-MID', name: 'Бета', status: 'accepted', date_created: '2026-06-01' },
];
const rowIds = (c: HTMLElement) => [...c.querySelectorAll('[data-record-id]')].map(r => r.getAttribute('data-record-id'));
function win(search: string): UrlWindow {
  return { location: { pathname: '/adrs', search, hash: '' }, history: { pushState: () => {}, replaceState: () => {} } } as unknown as UrlWindow;
}

describe('ListScreen: умолчание свежести и явный выбор в адресе', () => {
  it('без ls в адресе — свежие сверху', async () => {
    const { container } = render(<ListScreen screen="adrs" fetchImpl={async () => json({ rows: adrs })} urlState={win('')} />);
    await waitFor(() => expect(rowIds(container)).toHaveLength(3));
    expect(rowIds(container)).toEqual(['ADR-NEW', 'ADR-MID', 'ADR-OLD']);
  });

  it('явный ls в адресе главнее умолчания', async () => {
    const { container } = render(<ListScreen screen="adrs" fetchImpl={async () => json({ rows: adrs })} urlState={win('?ls=title')} />);
    await waitFor(() => expect(rowIds(container)).toHaveLength(3));
    expect(rowIds(container)).toEqual(['ADR-OLD', 'ADR-MID', 'ADR-NEW']);
  });
});
