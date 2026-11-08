// Обрамление блоков: прототип v4 против релиза (владелица 09.11: «разберись с
// фреймингом. прототип. вс. релиз»).
//
// Что намерил аудит 08.11 в релизе: «шапка 44 → зазор 9 → строка экрана 27 →
// зазор 8 → панель фильтров 63 → зазор 8 → таблица. У блоков нет своих
// отступов и рамок (padding: 0, border: 0) — разделяет только зазор 8 px.
// Из-за этого "шапка экрана" и "фильтры" читаются как одна серая масса».
//
// Что в прототипе (docs/prototypes/ux-redesign-shell-v4.html):
//   .hdr   { padding: 10px 14px 6px }                       — шапка экрана
//   .fbar  { padding: 4px 14px 8px; border-bottom: 1px … }  — полоса фильтров
//   .list th { background: var(--bg3); border-bottom: 1px … } — шапка таблицы
//   .tabs  { padding: 10px 16px 0; border-bottom: 1px … }    — линия вкладок
//
// То есть расхождение одностороннее: разделители были в прототипе и потерялись
// при переносе в kit — в этом файле стилей, не у соседних сессий. Поэтому
// правила ниже закреплены тестом: следующая правка не унесёт их молча.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('блоки списка разделены, а не слиты в одну массу', () => {
  it('положительный контроль: правила полосы фильтров и шапки таблицы найдены', () => {
    expect(ruleOf('.sk-list__controls')).not.toBe('');
    expect(ruleOf('.sk-list__th')).not.toBe('');
  });

  it('полоса фильтров отделена от таблицы линией, как в прототипе', () => {
    const rule = ruleOf('.sk-list__controls');
    expect(rule).toMatch(/border-bottom:\s*1px solid var\(--bd\)/);
    expect(rule).toMatch(/padding-bottom:/);
  });

  it('шапка таблицы — своя полоса фоном, а не тот же фон, что у строк', () => {
    expect(ruleOf('.sk-list__th')).toMatch(/background:\s*var\(--bg3\)/);
  });

  it('линия вкладок записи не висит в воздухе: свой отступ сверху', () => {
    expect(ruleOf('.sk-rec__tabs > .sk-tabs--underline')).toMatch(/padding:/);
  });

  it('у вкладок остаётся нижняя граница — она и делает из них линию', () => {
    expect(ruleOf('.sk-tabs')).toMatch(/border-bottom:\s*1px solid var\(--bd\)/);
  });
});
