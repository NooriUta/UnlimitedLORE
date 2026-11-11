// Паспорт на телефоне — по образцу v1 (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-MOBILE-COMPARE,
// D-2026-UXR-MOBILE-FOLLOWS-V1). Правила раскладки и вкладки по умолчанию живут
// в kit (kit/src/record/phonePassport.test.tsx); здесь — то, что от них зависит в
// приложении:
//  1. «Вкладка не выбрана» доходит до kit КАК НЕ ВЫБРАННАЯ. Раньше паспорт
//     подставлял 'overview' сам, и правило kit «на телефоне — первая вкладка по
//     модели» (у спринта — задачи) не могло сработать: kit видел явный выбор.
//  2. На телефоне паспорт во весь экран: поля экрана списка вокруг дока сняты
//     (замер 360 px: колонка записи 227 px из 360).
// Тест читает исходники, а не браузер: Playwright у нас локальный, в CI его нет.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const passport = readFileSync(join(__dirname, 'ListPassport.tsx'), 'utf8');
const css = readFileSync(join(__dirname, '../pages/ListScreen.css'), 'utf8');

describe('S4-MOBILE-COMPARE · паспорт на телефоне в приложении', () => {
  it('положительный контроль: паспорт держит вкладку в адресе', () => {
    expect(passport).toMatch(/useRecordTab\(/);
  });

  it('невыбранная вкладка — пустая, а не подставленный «обзор»', () => {
    expect(passport).toMatch(/useRecordTab\('', win\)/);
    expect(passport).not.toMatch(/useRecordTab\('overview'/);
  });

  it('положительный контроль: у экрана списка есть поля', () => {
    expect(css).toMatch(/\.list-screen \{[^}]*padding: var\(--pad-y\) var\(--pad-x\)/);
  });

  it('на узком экране поля экрана вокруг открытого паспорта сняты', () => {
    // Своим классом экрана, а не селектором по .sk-dock: CSS приложения правил
    // для классов kit не пишет (сторож kitBareParity).
    const m = css.match(/@media \(max-width: 720px\) \{([^@]*?\.list-screen--passport \{[^}]*\})/);
    expect(m, 'правила .list-screen--passport в @media (max-width: 720px) нет').not.toBeNull();
    expect(m![1]).toMatch(/padding-inline:\s*0/);
  });

  it('класс открытого паспорта ставит экран списка, когда паспорт открыт', () => {
    const screen = readFileSync(join(__dirname, '../pages/ListScreen.tsx'), 'utf8');
    expect(screen).toMatch(/open\.id && ready \? 'list-screen list-screen--passport' : 'list-screen'/);
  });
});
