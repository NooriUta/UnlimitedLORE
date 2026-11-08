// @vitest-environment jsdom
// Замечания владелицы по v2 на проде (v1.17.4, переданы 08.11.2026):
//
//  1) «ширина линии в паспорте считается от ширины экрана, а не контекста —
//     переключая вкладки, у меня изменяется ширина»;
//  2) «"развернуть на всю страницу" скрывает даже верхнее меню, чего не было в
//     прототипе».
//
// Это одна причина на два следствия. Док «во весь экран» — слой
// position: fixed; inset: 0, то есть во весь ЭКРАН: он накрывает шапку и меню,
// и все его проценты (линия вкладок ~66 %, текст ~66 % линии — пропорции,
// выбранные владелицей 08.11) считаются от окна. Внутри оболочки «во весь
// экран» должно значить «во всю область содержимого»: шапка и меню остаются,
// а проценты начинают считаться от контекста.
//
// Третье, что из этого следует: пока оболочка видна и ею можно пользоваться,
// слой не модальный. aria-modal="true" в этом случае — ложь для скринридера
// (он объявит шапку и меню несуществующими), поэтому модальность стала
// свойством использования, а не дока.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { RecordDock } from './RecordDock';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

describe('«во весь экран» внутри оболочки', () => {
  it('положительный контроль: правила дока и области содержимого найдены', () => {
    expect(ruleOf(".sk-dock[data-placement='full']")).not.toBe('');
    expect(ruleOf('.sk-shell__main')).not.toBe('');
  });

  it('сам по себе (витрина, демо) док во весь экран остаётся слоем поверх окна', () => {
    expect(ruleOf(".sk-dock[data-placement='full']")).toMatch(/position:\s*fixed/);
  });

  it('внутри оболочки — только область содержимого: шапка и меню остаются', () => {
    expect(ruleOf('.sk-shell__main')).toMatch(/position:\s*relative/);
    const inShell = ruleOf(".sk-shell__main .sk-dock[data-placement='full']");
    expect(inShell).toMatch(/position:\s*absolute/);
    expect(inShell).toMatch(/inset:\s*0/);
  });
});

describe('модальность — свойство использования, а не дока', () => {
  it('по умолчанию во весь экран — модальный диалог', () => {
    render(<RecordDock placement="full" onExitFull={() => {}}><p>паспорт</p></RecordDock>);
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
  });

  it('оболочка видна — не модальный: иначе шапка и меню «не существуют» для скринридера', () => {
    render(<RecordDock placement="full" modal={false} onExitFull={() => {}}><p>паспорт</p></RecordDock>);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('kit-rec-dock').getAttribute('aria-modal')).toBeNull();
  });

  it('место не полное — модальности нет ни при каких значениях', () => {
    render(<RecordDock placement="bottom" modal><p>паспорт</p></RecordDock>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('одна мера чтения в доке и во весь экран', () => {
  it('в доке у текста есть своя мера, а не ширина контейнера', () => {
    const rule = ruleOf(".sk-dock[data-placement='bottom'], .sk-dock[data-placement='right']");
    expect(rule).toMatch(/--rec-col:/);
    // min(100%, …) — мера от контекста: в узкой панели колонка не вылезает.
    expect(rule).toMatch(/min\(100%/);
    expect(rule).toMatch(/var\(--read-col/);
  });

  it('мера не зависит от вкладки: одно правило на шапку, свойства и содержимое вкладки', () => {
    const sel = ".sk-dock[data-placement='bottom'] .sk-tabpanel > *,\n.sk-dock[data-placement='right'] .sk-tabpanel > *";
    expect(css).toContain(sel);
  });

  it('пропорции во весь экран (выбор владелицы 08.11) не тронуты', () => {
    expect(ruleOf(".sk-dock[data-placement='full'] .sk-rec[data-width='m']")).toMatch(/--rec-col:\s*66%/);
  });
});
