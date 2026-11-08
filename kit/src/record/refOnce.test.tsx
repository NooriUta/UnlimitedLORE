// @vitest-environment jsdom
// Аудит навигации 08.11.2026, находка P0 в свойствах: «"ПРОЕКТЫ
// NooriUta/UnlimitedLORE" и рядом второй, обрезанный "NooriUta/UnlimitedLORE"
// — две подписи в одной строке»; и находка P2 в «Связях»: «подпись дублируется
// ("FORseti … FORseti ref")».
//
// Причина одна на оба случая. `RecordRef` печатает НАЗВАНИЕ записи и рядом её
// КОД. У проекта (и у многих компонентов) название и есть код —
// `NooriUta/UnlimitedLORE`, — поэтому один и тот же текст выводился дважды, а в
// колонке 320 px второй экземпляр не влезал и наезжал на край панели.
//
// Правило, а не заплатка под проекты: ссылка на запись показывает её код один
// раз. Название печатается только тогда, когда оно говорит что-то помимо кода.
//
// Второе: ссылка обязана укладываться в свою колонку. `inline-flex` без
// `min-width: 0` не сжимается ниже содержимого, и длинный код вылезал за
// границу панели — это и видно как «текст наезжает сам на себя».
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordRef } from './fmt';

const css = readFileSync(`${process.cwd()}/src/styles/seidr.css`, 'utf8');
const ruleOf = (sel: string) => {
  const start = css.indexOf(`\n${sel} {`);
  return start < 0 ? '' : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
};

const config: KitConfig = {
  modules: [], menu: { groups: [] },
  kinds: { project: { title: 'Проект', icon: 'scroll-quill' }, adr: { title: 'ADR', icon: 'scales' } },
  statuses: { items: [] },
};

function ctxOf(records: KitRecord[]): KitCtx {
  return {
    config, data: { records, edges: [], journal: [], meta: { generated_at: '2026-11-08T00:00:00Z' } },
    href: id => `#${id}`, esc: s => s, md: s => s,
  };
}

const rec = (id: string, title: string): KitRecord => ({ id, kind: 'project', title, status: '', fields: {} });

describe('ссылка на запись печатает код один раз', () => {
  it('положительный контроль: у записи с иным названием видно и название, и код', () => {
    render(<RecordRef id="ADR-LORE-048" ctx={ctxOf([{ ...rec('ADR-LORE-048', 'Одна модель'), kind: 'adr' }])} />);
    expect(screen.getByText('Одна модель')).toBeTruthy();
    expect(screen.getByText('ADR-LORE-048')).toBeTruthy();
  });

  it('название совпадает с кодом — текст не задваивается', () => {
    const { container } = render(<RecordRef id="NooriUta/UnlimitedLORE" ctx={ctxOf([rec('NooriUta/UnlimitedLORE', 'NooriUta/UnlimitedLORE')])} />);
    expect(screen.getAllByText('NooriUta/UnlimitedLORE')).toHaveLength(1);
    expect(container.querySelector('.sk-pill--id')).toBeNull();
  });

  it('совпадение с запасом на пробелы и регистр — тоже один раз', () => {
    render(<RecordRef id="FORseti" ctx={ctxOf([rec('FORseti', ' forseti ')])} />);
    expect(screen.getAllByText(/forseti/i)).toHaveLength(1);
  });

  it('названия нет — печатается код, и ровно один', () => {
    render(<RecordRef id="P-1" ctx={ctxOf([rec('P-1', '')])} />);
    expect(screen.getAllByText('P-1')).toHaveLength(1);
  });

  it('записи нет в данных — код остаётся виден и помечен как ненайденный', () => {
    const { container } = render(<RecordRef id="P-404" ctx={ctxOf([])} />);
    expect(screen.getByText('P-404')).toBeTruthy();
    expect(container.querySelector('[data-missing="true"]')).toBeTruthy();
  });
});

describe('ссылка укладывается в свою колонку', () => {
  it('положительный контроль: правила ссылки и набора ссылок найдены', () => {
    expect(ruleOf('.sk-rec-ref')).not.toBe('');
    expect(ruleOf('.sk-rec-fields__refs')).not.toBe('');
  });

  it('ссылка сжимается, а не вылезает за край панели', () => {
    expect(ruleOf('.sk-rec-ref')).toMatch(/min-width:\s*0/);
    expect(ruleOf('.sk-rec-ref')).toMatch(/max-width:\s*100%/);
  });

  it('набор ссылок не растягивает колонку', () => {
    expect(ruleOf('.sk-rec-fields__refs')).toMatch(/min-width:\s*0/);
    expect(ruleOf('.sk-rec-fields__refs')).toMatch(/max-width:\s*100%/);
  });
});
