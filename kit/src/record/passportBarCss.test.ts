// MP2-09/MP2-10/MP2-11 (SPRINT_UXR_MOBILE_POLISH, владелица 13.11.2026):
//   • верхний бар паспорта ОДНОСТРОЧНЫЙ при любом состоянии и во всю ширину
//     контейнера — и на телефоне, и на десктопе;
//   • «Ещё» в паспорте и меню смены места — в общем дизайне kit (как поповеры
//     фильтров): фон bg1, рамка bd, скругление r-lg, пункты с высотой тапа.
//
// Сторож читает seidr.css: правило, потерявшее nowrap или ширину, вернуло бы
// вторую строку бара при сжатом доке — именно то, что видела владелица.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/styles/seidr.css'), 'utf8');

function rule(selector: string): string {
  const i = css.indexOf(`${selector} {`);
  expect(i, `правила ${selector} в seidr.css нет — поправьте сторож`).toBeGreaterThan(-1);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
}

describe('MP2-09/10 · бар паспорта: одна строка и вся ширина', () => {
  it('бар не переносится и занимает всю ширину контейнера', () => {
    const body = rule('.sk-rec-reader__bar');
    expect(body).toContain('flex-wrap: nowrap');
    expect(body).toContain('width: 100%');
    expect(body).toContain('min-width: 0');
  });

  it('крошки сжимаются многоточием, а не переносят бар на вторую строку', () => {
    expect(rule('.sk-rec-reader__crumbs')).toContain('overflow: hidden');
    expect(rule('.sk-rec-reader__crumbs .sk-crumbs__cur')).toContain('text-overflow: ellipsis');
    expect(rule('.sk-rec-reader__tools')).toContain('flex: 0 0 auto');
  });

  it('на узком экране бар остаётся однострочным: зазоры и позиция листалки сжаты', () => {
    const i = css.indexOf('.sk-rec-reader__bar { gap: 4px; }');
    expect(i, 'узкое правило бара не найдено').toBeGreaterThan(-1);
    expect(css.slice(i, i + 220)).toContain('.sk-rec-reader__bar .sk-rec-pager__pos { min-width: 0;');
  });
});

describe('MP2-11 · «Ещё» и меню места — общий дизайн поповеров фильтров', () => {
  it('свёртка «Ещё»: фон, рамка и скругление как у панели фильтров', () => {
    const more = rule('.sk-tabs__more-pop');
    const panel = rule('.sk-vmenu__panel');
    for (const decl of ['background: var(--bg1)', 'border: 1px solid var(--bd)', 'border-radius: var(--r-lg)']) {
      expect(more, decl).toContain(decl);
      expect(panel, decl).toContain(decl);
    }
    expect(rule('.sk-tabs__more-item')).toContain('min-height: max(var(--tap), 30px)');
    expect(rule('.sk-tabs__more-item')).toContain('border-radius: var(--r-md)');
  });

  it('меню места паспорта: тот же язык и отметка выбранного', () => {
    const pop = rule('.sk-place__pop');
    expect(pop).toContain('background: var(--bg1)');
    expect(pop).toContain('border-radius: var(--r-lg)');
    expect(rule('.sk-place__opt')).toContain('min-height: max(var(--tap), 30px)');
    expect(css).toContain(".sk-place__opt[aria-checked='true']::after { content: '✓';");
  });

  it('поповер warnings: тот же язык, прокрутка внутри и в языке kit', () => {
    const pop = rule('.sk-warn__pop');
    expect(pop).toContain('background: var(--bg1)');
    expect(pop).toContain('border-radius: var(--r-lg)');
    expect(pop).toContain('max-height: 62vh');
    const body = rule('.sk-warn__body');
    expect(body).toContain('overflow: auto');
    expect(body).toContain('scrollbar-color: var(--bdh) transparent');
    expect(css).toContain('.sk-warn__body::-webkit-scrollbar-thumb { background: var(--bdh);');
  });

  it('значок warnings виден только с сообщениями и читается как предупреждение', () => {
    const btn = rule('.sk-warn__btn');
    expect(btn).toContain('border: 1px solid var(--wrn)');
    expect(btn).toContain('color: var(--wrn)');
    expect(btn).toContain('min-height: max(var(--tap), 24px)');
  });
});
