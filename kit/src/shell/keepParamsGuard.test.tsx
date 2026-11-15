// @vitest-environment jsdom
// Сторож keepParams (SPRINT_UXR_S14_KIT5/K5-KEEPPARAMS-GUARD).
//
// 15.11.2026 пилот «Дата-странников» передал KitShell keepParams={['rec','tab']}: открытая запись
// пережила смену раздела и осталась на экране при клике по меню (приёмка ME-1, 2 из 2). kit сделал,
// что велели, — но мог предупредить. Теперь предупреждает: параметр открытой записи в keepParams.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { KitShell, keepParamsConflicts } from './KitShell';
import type { KitConfig, KitData } from '../core/contract';

const config = { modules: [], menu: { groups: [] }, kinds: {}, statuses: { items: [] } } as unknown as KitConfig;
const data: KitData = { records: [], edges: [], journal: [], meta: { generated_at: '' } };

describe('keepParamsConflicts', () => {
  it('параметр записи в keepParams — назван', () => {
    expect(keepParamsConflicts(['rec', 'tab', 'proj'], ['rec', 'tab'])).toEqual(['rec', 'tab']);
  });
  it('без пересечения — пусто', () => {
    expect(keepParamsConflicts(['proj', 'lang'], ['rec', 'tab'])).toEqual([]);
  });
  it('приложение не назвало параметры записи — судить не о чем', () => {
    expect(keepParamsConflicts(['rec'], undefined)).toEqual([]);
  });
});

describe('KitShell · предупреждение в разработке', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keepParams с параметром записи — предупреждение словами', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<KitShell config={config} data={data} keepParams={['rec', 'proj']} recordParams={['rec', 'tab']} />);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/rec.*не снимется при смене раздела/);
  });

  it('без пересечения — тихо', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    render(<KitShell config={config} data={data} keepParams={['proj']} recordParams={['rec', 'tab']} />);
    expect(warn).not.toHaveBeenCalled();
  });
});
