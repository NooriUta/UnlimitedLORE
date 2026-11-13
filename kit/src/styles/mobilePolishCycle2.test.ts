// Мобильный цикл 2 (SPRINT_UXR_MOBILE_POLISH/MP2-01…06, проход 13.11.2026).
// Замеры прохода: ряд типов новостей 419px в коробке 344px (перенос не
// срабатывал — ряд не получал ширины строки); сегмент «Палитра» 430px в
// коробке 335px растягивал лист; группа поиск/команды 81px в коробке 77px;
// листы скроллятся дефолтной серой полосой движка.
//
// Сторож читает узкие media-блоки (max-width: 720px / coarse+низкий), потому
// что именно там живут телефонные правила: правка в базовом слое сломала бы
// десктоп, а сторож этого не увидел бы.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');

/** Тело media-блока по балансу скобок: иначе в «блок» утекает базовый слой,
    идущий после условия, и сторож читает десктопные правила как телефонные. */
function mediaBody(chunk: string): string {
  const i = chunk.indexOf('{');
  let depth = 0;
  for (let j = i; j < chunk.length; j++) {
    if (chunk[j] === '{') depth++;
    else if (chunk[j] === '}') {
      depth--;
      if (depth === 0) return chunk.slice(i + 1, j);
    }
  }
  return chunk.slice(i + 1);
}

const narrowBlocks = css
  .split('@media')
  .filter((b) => b.startsWith(' (max-width: 720px), (pointer: coarse) and (max-height: 500px)'))
  .map(mediaBody);

/** Тело первого правила с селектором внутри любого узкого блока. */
function narrowRule(selector: string): string | null {
  for (const b of narrowBlocks) {
    const i = b.indexOf(`${selector} {`);
    if (i > -1) return b.slice(b.indexOf('{', i) + 1, b.indexOf('}', i));
  }
  return null;
}

describe('мобильный цикл 2: переносы и скроллбары листов', () => {
  it('положительный контроль: узкие блоки найдены', () => {
    expect(narrowBlocks.length).toBeGreaterThan(3);
  });

  it('MP2-01: ряд типов получает полную ширину строки и переносит чипы внутри', () => {
    const r = narrowRule('.sk-news__frow > .sk-news__types');
    expect(r, 'узкое правило ряда типов не найдено').not.toBeNull();
    expect(r).toContain('flex: 1 1 100%');
    expect(r).toContain('min-width: 0');
    expect(r).toContain('flex-wrap: wrap');
  });

  it('MP2-02: сегмент настроек переносит опции и не растягивает лист', () => {
    const r = narrowRule('.sk-seg');
    expect(r, 'узкое правило .sk-seg не найдено').not.toBeNull();
    expect(r).toContain('flex-wrap: wrap');
    expect(r).toContain('max-width: 100%');
  });

  it('MP2-03: группа поиск/команды влезает в коробку шапки на узком', () => {
    const r = narrowRule('.sk-ptrig');
    expect(r, 'узкое правило .sk-ptrig не найдено').not.toBeNull();
    expect(r).toContain('gap: 2px');
  });

  it('MP2-06: скроллбар листа в языке kit, а не дефолтная серая полоса', () => {
    expect(css).toContain('.sk-sheet { scrollbar-width: thin; scrollbar-color: var(--bdh) transparent; }');
    expect(css).toContain('.sk-sheet::-webkit-scrollbar-thumb { background: var(--bdh); border-radius: 8px; }');
    expect(css).toContain('.sk-sheet::-webkit-scrollbar-thumb:hover { background: var(--acc); }');
  });
});
