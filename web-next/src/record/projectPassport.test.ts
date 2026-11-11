// Паспорт проекта (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29, решение 53а
// D-2026-UXR-OWNER-DELEGATED-ANSWERS-10-11).
//
// Сервер заводит тип `project` (/lore/record/project/<slug>); здесь — клиентская
// половина: тип в перечне паспортов, раздел «Проекты» в оболочке и, главное,
// ЧИПЫ ПРОЕКТОВ В ШАПКЕ любого паспорта открывают этот паспорт. До правки
// чип вёл на «#slug»: тип проекта не знал никто, и ссылка уходила в никуда.
// Тем же путём чинятся чипы компонентов — правило одно: чип открывает
// паспорт своего типа.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordHref } from '../nav/loreRoutes';
import { V2_SECTIONS } from '../shell/v2Config';
import { LIST_SCREENS } from '../lists/screens';
import { projectRecord } from '../lists/records';
import { passportHref } from './passportHref';

const GP = 'NooriUta/UnlimitedLORE';

describe('паспорт проекта · маршрут и раздел', () => {
  it('у проекта есть раздел v2 и адрес записи ?sec=project&open=<slug>', () => {
    expect(V2_SECTIONS as readonly string[]).toContain('project');
    const href = recordHref('project', GP);
    expect(href).not.toBeNull();
    const q = new URLSearchParams(href!.split('?')[1]);
    expect(q.get('sec')).toBe('project');
    expect(q.get('open')).toBe(GP);
  });

  it('раздел «Проекты» читает git_projects; строка — slug ключом, имя названием', () => {
    expect((LIST_SCREENS as Record<string, { slice: string }>).projects.slice).toBe('git_projects');
    const r = projectRecord({ slug: GP, name: 'UnlimitedLORE', default_branch: 'develop', is_private: true });
    expect(r).toMatchObject({ id: GP, kind: 'project', title: 'UnlimitedLORE', status: '' });
    expect(r.fields.default_branch).toBe('develop');
    expect(projectRecord({ slug: GP }).title).toBe(GP);
  });
});

describe('чипы шапки открывают паспорт своего типа', () => {
  const values = {
    projects: [{ id: GP, label: 'UnlimitedLORE', inherited_from: null }],
    components: [{ id: 'LORE', label: 'Хранилище', inherited_from: { type: 'sprint', id: 'S' } }],
  };
  const href = passportHref([{ id: 'SPRINT_X', kind: 'sprint' }], values, id => `#${id}`);

  it('чип проекта → паспорт проекта', () => {
    expect(href(GP)).toBe(recordHref('project', GP));
  });

  it('чип компонента → паспорт компонента', () => {
    expect(href('LORE')).toBe(recordHref('component', 'LORE'));
  });

  it('загруженная запись — по своему типу, незнакомый код — запасная ссылка, раздел не выдумывается', () => {
    expect(href('SPRINT_X')).toBe(recordHref('sprint', 'SPRINT_X'));
    expect(href('NOPE')).toBe('#NOPE');
  });

  it('значения строками (старая форма) тоже узнаются', () => {
    const h = passportHref([], { projects: [GP], components: ['LORE'] }, id => `#${id}`);
    expect(h(GP)).toBe(recordHref('project', GP));
    expect(h('LORE')).toBe(recordHref('component', 'LORE'));
  });

  it('паспорт оболочки строит ссылки через passportHref', () => {
    const src = readFileSync(join(__dirname, 'ListPassport.tsx'), 'utf8');
    expect(src).toMatch(/passportHref\(/);
  });
});
