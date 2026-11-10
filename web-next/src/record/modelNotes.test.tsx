// @vitest-environment jsdom
// B14 ревью владелицы 10.11.2026: «Панель предупреждений перекрывает шапку
// паспорта. Плавающая панель (×) висит поверх правого верхнего угла паспорта.
// По пожеланию владелицы — перенести в поток (вниз шапки списка) или в шеврон
// „⚠ N“ с выпадением; показывать владельцам модели».
//
// ЧТО ИМЕННО перекрывало (доказано файлом:строкой, а не на глаз):
//   • оговорки разбора модели рисует `ListPassport.tsx:209` —
//     `<ul className="pp-model-note">`, ПЕРВЫЙ блок внутри `.sk-dock__panel`;
//   • сама панель НЕ позиционирована (`ListPassport.css:16` — ни position, ни
//     z-index): абсолютом над паспортом висит не она;
//   • поверх её правого верхнего угла лежит кнопка закрытия дока —
//     `kit/src/record/RecordDock.tsx:116` рисует `.sk-dock__close`, а
//     `kit/src/styles/seidr.css:5340` даёт ей `position: sticky; float: right;
//     z-index: 1`. Флоат вынут из потока: следующие БЛОЧНЫЕ боксы (полоса
//     оговорок, а за ней шапка записи) верстаются как будто его нет, поэтому
//     он и закрывает их правый верхний угол.
//
// Правило, которое держат эти тесты:
//   1. Панель оговорок живёт В ПОТОКЕ и не залезает под плавающую «×»
//      (угол отдан кнопке явно, а не на удачу).
//   2. Свёрнутая панель НЕ выглядит как «предупреждений нет»: в самом шевроне
//      стоит их число и слово о том, что это оговорки модели.
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelNotes } from './ModelNotes';

const NOTES = [
  'статусы — умолчание приложения: документа в ответе нет',
  'порядок разделов — клиентский: модель его не задаёт',
];

// jsdom: import.meta.url недоступен, читаем от корня пакета.
const css = readFileSync(join(process.cwd(), 'src/record/ListPassport.css'), 'utf8');

/** Тело правила по селектору (первое вхождение). */
function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `правила ${selector} в ListPassport.css нет — поправьте сторож`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}

describe('B14 · оговорки модели: шеврон в потоке, а не панель поверх шапки', () => {
  it('положительный контроль: с оговорками панель есть, без них её нет', () => {
    const { container, unmount } = render(<ModelNotes notes={NOTES} />);
    expect(container.querySelector('.pp-model-note')).toBeTruthy();
    unmount();
    const empty = render(<ModelNotes notes={[]} />);
    expect(empty.container.querySelector('.pp-model-note')).toBeNull();
  });

  it('это шеврон: по умолчанию свёрнут, раскрывается щелчком', () => {
    const { container } = render(<ModelNotes notes={NOTES} />);
    const box = container.querySelector('details');
    expect(box, 'оговорки должны быть свёрткой <details>, а не всегда развёрнутой панелью').toBeTruthy();
    expect(box?.hasAttribute('open'), 'по умолчанию свёрнут').toBe(false);
    const sum = container.querySelector('summary');
    expect(sum).toBeTruthy();
    fireEvent.click(sum!);
    expect(container.querySelector('details')?.hasAttribute('open'), 'щелчок раскрывает').toBe(true);
  });

  it('свёрнутый шеврон не выглядит как «предупреждений нет»: число и слово в нём самом', () => {
    const { container } = render(<ModelNotes notes={NOTES} />);
    const sum = container.querySelector('summary')?.textContent ?? '';
    expect(sum, 'в шевроне должно стоять число оговорок').toMatch(/2/);
    expect(sum.toLowerCase(), 'и слово о том, что это оговорки модели').toMatch(/оговорк|модел/);
    expect(sum).toContain('⚠');
  });

  it('сами оговорки лежат внутри свёртки — раскрытие их показывает целиком', () => {
    const { container } = render(<ModelNotes notes={NOTES} />);
    const box = container.querySelector('details');
    for (const n of NOTES) expect(box?.textContent ?? '').toContain(n);
    // Живая область остаётся на внешней обёртке: панель объявляется
    // состоянием, а не ошибкой (как было у `<ul role="status">`).
    expect(container.querySelector('.pp-model-note[role="status"]')).toBeTruthy();
  });

  it('панель в потоке: ни position, ни z-index — абсолютом над паспортом она не висит', () => {
    const body = rule('.pp-model-note');
    expect(body).not.toMatch(/position:\s*(absolute|fixed)/);
    expect(body).not.toMatch(/z-index/);
  });

  it('правый верхний угол отдан плавающей «×» дока: панель под неё не заходит', () => {
    const body = rule('.pp-model-note');
    // Кнопка закрытия — float: right, шириной max(var(--tap), 28px)
    // (kit/src/styles/seidr.css:5340). Поэтому отступ справа считается от того
    // же токена: на телефоне палец берёт 44px, и «на глаз» подобранные px
    // снова дали бы наложение.
    expect(body, 'панель обязана оставить место кнопке «×», иначе та ложится ей на угол').toMatch(/margin-right:[^;]*--tap/);
  });

  it('только токены: сырых px-шрифтов и hex-цветов в правилах панели нет', () => {
    for (const sel of ['.pp-model-note', '.pp-model-note__sum', '.pp-model-note__list']) {
      const body = rule(sel);
      expect(body, sel).not.toMatch(/font-size:\s*\d/);
      expect(body, sel).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
