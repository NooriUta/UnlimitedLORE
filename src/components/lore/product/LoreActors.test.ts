import { describe, it, expect } from 'vitest';
import { filterActors, actorProjectCounts, ALL_PROJECTS, NO_PROJECT } from './LoreActors';

const ROWS = [
  { actor_id: 'ACT-ARCHITECT', name: 'Архитектор', kind: 'human-role', projects: ['org/lore'] },
  { actor_id: 'ACT-CLAUDE', name: 'Агент Claude', kind: 'automation', projects: ['org/lore', 'org/aida'] },
  { actor_id: 'ACT-CI', name: 'CI-раннер', kind: 'system', projects: ['org/aida'] },
  // Актор без проектов вовсе — при включённом скоупе его не увидит никто.
  { actor_id: 'ACT-LEGACY', name: 'Без вида', kind: null, projects: [] },
];

describe('PL-18 · фильтр реестра акторов', () => {
  it('вид отбирает только свои строки', () => {
    expect(filterActors(ROWS, 'automation', '').map(r => r.actor_id)).toEqual(['ACT-CLAUDE']);
  });

  it('«все» ничего не отсекает — включая строки без вида', () => {
    // Актор без kind — не гипотетика: поле необязательное, и записи, заведённые
    // до появления словаря, его не несут. Отбрось их «все» — реестр молча
    // потерял бы часть корпуса, а пустой список читался бы как «акторов нет».
    expect(filterActors(ROWS, 'all', '')).toHaveLength(4);
  });

  it('вид и текст сужают выборку ВМЕСТЕ, а не по очереди', () => {
    // Ключевая проверка: «люди» + «claude» обязаны дать пусто. Если условия
    // склеены неверно, текст перебьёт вид и вернётся агент — фильтр при этом
    // выглядит работающим, пока не спросишь его о пересечении.
    expect(filterActors(ROWS, 'human-role', 'claude')).toEqual([]);
    expect(filterActors(ROWS, 'automation', 'claude').map(r => r.actor_id)).toEqual(['ACT-CLAUDE']);
  });

  it('текст ищет и по id, и по имени, без учёта регистра и пробелов по краям', () => {
    expect(filterActors(ROWS, 'all', '  РАННЕР ').map(r => r.actor_id)).toEqual(['ACT-CI']);
    expect(filterActors(ROWS, 'all', 'act-ci').map(r => r.actor_id)).toEqual(['ACT-CI']);
  });
});

describe('AL-96 · проектный разрез реестра акторов', () => {
  it('фасет проекта отбирает акторов этого проекта, включая многопроектных', () => {
    // ACT-CLAUDE висит в двух проектах и обязан находиться по КАЖДОМУ из них:
    // правило «виден при любом разрешённом» на клиенте должно совпадать с тем,
    // как скоуп работает на бэкенде.
    expect(filterActors(ROWS, 'all', '', 'org/lore').map(r => r.actor_id))
      .toEqual(['ACT-ARCHITECT', 'ACT-CLAUDE']);
    expect(filterActors(ROWS, 'all', '', 'org/aida').map(r => r.actor_id))
      .toEqual(['ACT-CLAUDE', 'ACT-CI']);
  });

  it('«все проекты» — значение по умолчанию, ничего не отсекает', () => {
    expect(filterActors(ROWS, 'all', '', ALL_PROJECTS)).toHaveLength(4);
    // Отсутствие четвёртого аргумента обязано вести себя так же: старые
    // вызовы фильтра не должны молча начать что-то отсекать.
    expect(filterActors(ROWS, 'all', '')).toHaveLength(4);
  });

  it('«без проекта» — отдельное значение, а не разновидность «всех»', () => {
    // Именно этих акторов не увидит никто при включённом скоупе, поэтому
    // найти их должно быть можно намеренно.
    expect(filterActors(ROWS, 'all', '', NO_PROJECT).map(r => r.actor_id)).toEqual(['ACT-LEGACY']);
  });

  it('проект и вид сужают выборку вместе', () => {
    expect(filterActors(ROWS, 'automation', '', 'org/aida').map(r => r.actor_id)).toEqual(['ACT-CLAUDE']);
    expect(filterActors(ROWS, 'system', '', 'org/lore')).toEqual([]);
  });

  it('проект и текст сужают выборку вместе', () => {
    expect(filterActors(ROWS, 'all', 'claude', 'org/lore').map(r => r.actor_id)).toEqual(['ACT-CLAUDE']);
    expect(filterActors(ROWS, 'all', 'раннер', 'org/lore')).toEqual([]);
  });

  it('счётчик считает вхождения, а многопроектный актор попадает в каждый проект', () => {
    const counts = actorProjectCounts(ROWS);
    expect(counts.get('org/lore')).toBe(2);
    expect(counts.get('org/aida')).toBe(2);
    // Актор без проектов не создаёт фантомной записи в счётчике.
    expect(counts.size).toBe(2);
  });

  it('null внутри массива проектов не превращается в проект', () => {
    // Слайс отдаёт поле обходом рёбер; у вершины без рёбер там приходит
    // массив с null, а не пустой массив, — и без фильтрации в фасете
    // появился бы чип «null».
    const rows = [{ actor_id: 'A', projects: [null] }];
    expect(actorProjectCounts(rows).size).toBe(0);
    expect(filterActors(rows, 'all', '', NO_PROJECT).map(r => r.actor_id)).toEqual(['A']);
  });
});
