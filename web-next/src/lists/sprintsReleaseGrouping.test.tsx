// @vitest-environment jsdom
// SPRINT_UXR_S9_SCALE_OPT/S9-02 — остаток: разрез «по релизу» в приложении.
//
// Механика kit (топ-10 + «Прочие», поиск по группам, list.collapsedGroupings)
// сделана 09–10.11, но у списка спринтов разреза по релизу не было вовсе —
// правило «по релизу свёрнуто» проверялось только на абстрактной оси kit.
// Релизов у LORE больше сотни, поэтому разрез свёрнут при первом показе.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListView, type KitData, type KitRecord } from '@seidr/kit';
import { LIST_SCREENS } from './screens';

const cfg = LIST_SCREENS.sprints.config('ru');

const rec = (i: number): KitRecord => ({
  id: `SPRINT_${i}`, kind: 'sprint', title: `Спринт ${i}`, status: 'active',
  fields: { release: `v1.${i % 15}` },
});
const data: KitData = {
  records: Array.from({ length: 90 }, (_, i) => rec(i)),
  edges: [], journal: [], meta: { generated_at: '2026-11-11T00:00:00Z', total: 90 },
};

describe('S9-02 · список спринтов: разрез по релизу', () => {
  it('разрез «релиз» есть среди группировок экрана', () => {
    expect(cfg.list?.groupings).toContain('release');
  });

  it('разрез «релиз» свёрнут при первом показе', () => {
    expect(cfg.list?.collapsedGroupings).toContain('release');
  });

  it('при группировке по релизу группы свёрнуты — строк спринтов на экране нет', () => {
    // 15 релизов — меньше порога «>20 групп», так что свёртку даёт именно
    // collapsedGroupings, а не бюджет групп.
    render(<ListView config={cfg} data={data} urlState={false} initial={{ group: 'release' }} />);
    expect(screen.queryByText('Спринт 0')).toBeNull();
    // Шапки групп при этом на месте: свёрнуто, а не пропало.
    expect(screen.getAllByRole('button', { expanded: false }).length).toBeGreaterThan(0);
  });
});
