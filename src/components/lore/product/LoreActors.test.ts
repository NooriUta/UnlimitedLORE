import { describe, it, expect } from 'vitest';
import { filterActors } from './LoreActors';

const ROWS = [
  { actor_id: 'ACT-ARCHITECT', name: 'Архитектор', kind: 'human-role' },
  { actor_id: 'ACT-CLAUDE', name: 'Агент Claude', kind: 'agent' },
  { actor_id: 'ACT-CI', name: 'CI-раннер', kind: 'system' },
  { actor_id: 'ACT-LEGACY', name: 'Без вида', kind: null },
];

describe('PL-18 · фильтр реестра акторов', () => {
  it('вид отбирает только свои строки', () => {
    expect(filterActors(ROWS, 'agent', '').map(r => r.actor_id)).toEqual(['ACT-CLAUDE']);
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
    expect(filterActors(ROWS, 'agent', 'claude').map(r => r.actor_id)).toEqual(['ACT-CLAUDE']);
  });

  it('текст ищет и по id, и по имени, без учёта регистра и пробелов по краям', () => {
    expect(filterActors(ROWS, 'all', '  РАННЕР ').map(r => r.actor_id)).toEqual(['ACT-CI']);
    expect(filterActors(ROWS, 'all', 'act-ci').map(r => r.actor_id)).toEqual(['ACT-CI']);
  });
});
