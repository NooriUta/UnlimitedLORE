// K4-MENTION-LOOK (SPRINT_UXR_S13_KIT4): цвет вида записи — канон v1, который
// называет модель сервера (`type_color`), а kit держит токенами `--section-*`.
// Сторож: три места — модель, приложение, тема kit — говорят одно и то же.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LORE_KIND_COLOR, loreKindLook, loreKinds, withLoreKindLook } from './loreKinds';
import { loreRefLook } from '../record/loreMdRefs';
import { v2Config } from './v2Config';
import { baseConfig } from '../record/passportAdapters';
import { KIT_CSS } from '../test/kitPaths';

const ROOT = resolve(__dirname, '..', '..', '..');
const model = JSON.parse(readFileSync(resolve(ROOT, 'shared', 'model', 'lore-model.json'), 'utf8')) as {
  type_color: Record<string, string>; no_type_color: string[];
};
const kitCss = readFileSync(KIT_CSS, 'utf8');

describe('цвет вида: модель ↔ приложение ↔ тема kit', () => {
  it('положительный контроль: в модели есть канон цветов', () => {
    expect(Object.keys(model.type_color).length).toBeGreaterThan(5);
  });
  it('каждый тип с каноном в модели окрашен тем же токеном (section-X модели = --section-X темы)', () => {
    for (const [type, token] of Object.entries(model.type_color)) {
      expect(LORE_KIND_COLOR[type], type).toBe(`var(--${token})`);
    }
    expect(Object.keys(LORE_KIND_COLOR).sort()).toEqual(Object.keys(model.type_color).sort());
  });
  it('у типа без канона цвета нет — не выдумываем', () => {
    const kinds = loreKinds('ru');
    for (const t of model.no_type_color) expect(kinds[t]?.color, t).toBeUndefined();
  });
  it('каждый токен цвета вида объявлен темой kit', () => {
    for (const c of Object.values(LORE_KIND_COLOR)) {
      const name = c.slice(4, -1);
      expect(kitCss, name).toMatch(new RegExp(`${name}\\s*:`));
    }
  });
});

describe('облик видов доходит до экранов', () => {
  it('оболочка: виды с цветом', () => {
    expect(v2Config('ru').kinds.adr.color).toBe('var(--section-adrs)');
  });
  it('паспорт: в конфиге облик ВСЕХ видов, своё описание вида главнее', () => {
    const cfg = baseConfig('ru', { sprint: { title: 'Свой', icon: 'x' } });
    expect(cfg.kinds.adr.color).toBe('var(--section-adrs)');
    expect(cfg.kinds.sprint.title).toBe('Свой');
    expect(cfg.kinds.sprint.icon).toBe('x');
    expect(cfg.kinds.sprint.color).toBe('var(--section-sprints)');
  });
  it('withLoreKindLook не трогает вид, которого LORE не знает', () => {
    expect(withLoreKindLook('ru', { zzz: { title: 'Z', icon: 'z' } }).zzz).toEqual({ title: 'Z', icon: 'z' });
  });
  it('MD: облик ссылки по типу и по форме кода', () => {
    const look = loreRefLook('ru');
    expect(look({ id: 'ADR-LORE-050', type: 'adr' })?.color).toBe('var(--section-adrs)');
    expect(look({ id: 'ADR-LORE-050', type: null })?.color).toBe('var(--section-adrs)');
    expect(look({ id: 'что-то', type: null })).toBeNull();
    expect(loreKindLook('ru', 'ADR')?.icon).toBe('scroll-quill');
  });
});
