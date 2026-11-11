// Переходы из ленты новостей в v2 (прод v1.17.7, владелица 09.11: «некоторые
// переходы странно себя ведут»; «меню не должны ни по одной ссылке пропадать»).
//
// Проба в Chrome на new.lore: лента строила адреса v1 (/lore?section=…&passport=…).
// В v2 они вели: ADR, решение, спека, вопрос, релиз — в оболочку без записи с
// «не смогли»; задача и спринт — на отдельную страницу паспорта БЕЗ меню; у
// релиза проект удваивался (NooriUta/X#NooriUta/X#v1.17.5).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { NewsEvent } from '@seidr/kit';
import { V2_SECTIONS } from '../shell/v2Config';
import { newsHrefV2, newsRefHrefV2 } from './newsLinks';

const ev = (type: string, el: string, projects: string[] = []) =>
  ({ type, el, projects } as unknown as NewsEvent);

describe('ссылки ленты ведут в разделы v2 с открытой записью', () => {
  it.each([
    ['adr', 'ADR-LORE-049', '/?mod=forseti&sec=adr&open=ADR-LORE-049'],
    ['decision', 'D-2026-ADMIN-ONE-INTERFACE', '/?mod=forseti&sec=decision&open=D-2026-ADMIN-ONE-INTERFACE'],
    ['spec', 'SPEC-LORE-KIT-FEED-VIEW', '/?mod=forseti&sec=spec&open=SPEC-LORE-KIT-FEED-VIEW'],
    ['question', 'OQ-MINILORE-MACHINE-MULTI-OWNERS', '/?mod=forseti&sec=question&open=OQ-MINILORE-MACHINE-MULTI-OWNERS'],
    ['sprint', 'SPRINT_UXR_S10_SEIDR_KIT_2', '/?mod=forseti&sec=sprint&open=SPRINT_UXR_S10_SEIDR_KIT_2'],
    ['task', 'SPRINT_UXR_S2_GRAPH_MEMORY/S2-15', '/?mod=forseti&sec=task&open=SPRINT_UXR_S2_GRAPH_MEMORY%2FS2-15'],
  ])('%s → раздел v2, а не адрес v1', (type, el, want) => {
    const href = newsHrefV2(ev(type, el))!;
    expect(href).toBe(want);
    expect(href).not.toMatch(/\/lore\?|section=|passport=/);
  });

  it('релиз: код уже «проект#версия» — проект второй раз не приклеивается', () => {
    expect(newsHrefV2(ev('release', 'NooriUta/UnlimitedLORE#v1.17.5', ['NooriUta/UnlimitedLORE'])))
      .toBe('/?mod=forseti&sec=release&open=NooriUta%2FUnlimitedLORE%23v1.17.5');
    // Голая версия — пара с первым проектом события.
    expect(newsHrefV2(ev('release', 'v1.17.0', ['NooriUta/UnlimitedLORE'])))
      .toBe('/?mod=forseti&sec=release&open=NooriUta%2FUnlimitedLORE%23v1.17.0');
  });

  it('каждый раздел ссылки существует в v2; неизвестный тип — без ссылки', () => {
    for (const type of ['adr', 'decision', 'spec', 'question', 'sprint', 'task', 'release']) {
      const sec = new URLSearchParams(newsHrefV2(ev(type, 'X'))!.slice(1)).get('sec');
      expect(V2_SECTIONS as readonly string[]).toContain(sec);
    }
    expect(newsHrefV2(ev('unknown-type', 'X'))).toBeNull();
  });

  // S7A-01: вехи и компоненты — новые типы ленты; у обоих есть раздел и паспорт v2.
  it.each([
    ['milestone', 'M-UXR-MVP', '/?mod=forseti&sec=milestone&open=M-UXR-MVP'],
    ['component', 'FORSETI', '/?mod=forseti&sec=component&open=FORSETI'],
  ])('%s → раздел v2 с открытой записью', (type, el, want) => {
    expect(newsHrefV2(ev(type, el))).toBe(want);
  });

  it('сторож: каждое <NewsFeed> в приложении получает hrefOf={newsHrefV2}', () => {
    const SRC = join(__dirname, '..');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
    const uses = walk(SRC).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.includes('<NewsFeed ')).map(l => ({ f, l })));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter(u => !u.l.includes('hrefOf={newsHrefV2}')).map(u => u.f)).toEqual([]);
  });
});

// S7A-08, п.24 — решение владелицы 10.11.2026: «всё, что можно открыть, делать
// ссылкой: в ленте открываются люди и любой объект, у которого есть паспорт».
describe('S7A-08 · П24: ссылки на людей и связанные записи строки ленты', () => {
  it('человек — его карточка в «Кто где» (раскрыта по kc_sub)', () => {
    expect(newsRefHrefV2('person', 'sub-anna')).toBe('/admin?adm=who&adm-open=sub-anna');
  });

  it('агент — раздел агентов админки', () => {
    expect(newsRefHrefV2('agent', 'mcp-lore')).toBe('/admin?adm=agents');
  });

  it.each([
    ['sprint', 'SPRINT_UXR_S7A_NEWS', '/?mod=forseti&sec=sprint&open=SPRINT_UXR_S7A_NEWS'],
    ['adr', 'ADR-LORE-045', '/?mod=forseti&sec=adr&open=ADR-LORE-045'],
    ['milestone', 'M-UXR-MVP', '/?mod=forseti&sec=milestone&open=M-UXR-MVP'],
    ['component', 'FORSETI', '/?mod=forseti&sec=component&open=FORSETI'],
  ])('%s — запись в своём разделе v2', (type, id, want) => {
    expect(newsRefHrefV2(type, id)).toBe(want);
  });

  it('паспорта нет (проект) или id пуст — null, а не выдуманный адрес', () => {
    expect(newsRefHrefV2('project', 'NooriUta/UnlimitedLORE')).toBeNull();
    expect(newsRefHrefV2('person', '')).toBeNull();
  });

  it('сторож: каждое <NewsFeed> в приложении получает refHrefOf={newsRefHrefV2}', () => {
    const SRC = join(__dirname, '..');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
    const uses = walk(SRC).flatMap(f => readFileSync(f, 'utf8').split('\n').filter(l => l.includes('<NewsFeed ')).map(l => ({ f, l })));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter(u => !u.l.includes('refHrefOf={newsRefHrefV2}')).map(u => u.f)).toEqual([]);
  });
});
