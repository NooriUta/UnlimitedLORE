import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { UrlWindow } from '@seidr/kit';
import App from './App';

// Старые адреса отдельных страниц паспорта (S5-02 спринт, S5-04 задача) открывают
// оболочку с записью во весь экран («да» владелицы 09.11): меню больше не пропадает.
describe('LORE v2 — старый адрес паспорта ведёт в оболочку', () => {
  const fakeWin = (search: string) => {
    const calls: string[] = [];
    const w = {
      location: { pathname: '/', search, hash: '' },
      history: { pushState: () => {}, replaceState: (_s: unknown, _t: string, url: string) => { calls.push(url); } },
    };
    return { w: w as unknown as UrlWindow, calls };
  };

  it('спринт: адрес переписывается в раздел «Спринты», рисуется оболочка, а не страница вне неё', () => {
    const { w, calls } = fakeWin('?section=sprints&passport=SPRINT_X');
    const html = renderToString(<App path="/" search="?section=sprints&passport=SPRINT_X" win={w} />);
    expect(calls).toEqual(['/?mod=forseti&sec=sprint&open=SPRINT_X&place=full&tab=tasks']);
    expect(html).toContain('sk-shell');
    expect(html).not.toContain('outside-shell');
  });

  it('задача: адрес переписывается в раздел «Задачи» во весь экран', () => {
    const { w, calls } = fakeWin('?section=tasks&passport=SPRINT_A%2FT-1');
    renderToString(<App path="/" search="?section=tasks&passport=SPRINT_A%2FT-1" win={w} />);
    expect(calls).toEqual(['/?mod=forseti&sec=task&open=SPRINT_A%2FT-1&place=full']);
  });

  it('обычный адрес не переписывается', () => {
    const { w, calls } = fakeWin('?mod=forseti&sec=adr');
    renderToString(<App path="/" search="?mod=forseti&sec=adr" win={w} />);
    expect(calls).toEqual([]);
  });
});

describe('LORE v2 — оболочка', () => {
  it('рендерится и называет себя v2, чтобы её нельзя было спутать с v1', () => {
    const html = renderToString(<App />);
    expect(html).toContain('LORE');
    expect(html).toContain('data-lore-app="v2"');
  });

  it('S4-03: в шапке — выбор нескольких проектов', () => {
    const html = renderToString(<App />);
    expect(html).toContain('sk-scope__trigger');
    expect(html).toMatch(/Проекты/);
  });
});
