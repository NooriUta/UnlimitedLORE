// @vitest-environment jsdom
// SPRINT_UXR_S14_KIT5/K5-VERDICT-CONTRACT — честный вердикт.
//
// Чужое приложение на kit («Дата-странники», SPRINT_DWL_METHOD/ME-10) увидело три нечестных
// состояния строки вердикта:
//   1. провал без текста: `failed` — список кодов, на карточке «Не пройдено quiz» вместо
//      «нет квиза по руне темы» (ADR-LORE-039 требует провал с текстом);
//   2. «не смогли проверить» некуда положить: проверка, чей источник не прочитался, молчит;
//   3. запись без проверок: контракт требовал вердикт всегда, и при нуле проверок kit писал
//      «Все проверки пройдены».
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord, KitVerdict } from '../core/contract';
import { verdictCode, verdictText } from '../core/verdict';
import { RecordVerdict } from './RecordHead';
import { verdictTone } from './graph';

const rec: KitRecord = { id: 'topic:0.1', kind: 'topic', title: 'Тема', status: '', fields: {} };
const ctxWith = (verdict: KitConfig['verdict']): KitCtx => ({ config: { verdict } as unknown as KitConfig } as unknown as KitCtx);
const show = (v: KitVerdict | undefined) => render(<RecordVerdict record={rec} ctx={ctxWith(() => v)} lang="ru" />);

describe('K5-VERDICT-CONTRACT · статья вердикта', () => {
  it('положительный контроль: прежняя форма — код строкой — читается как раньше', () => {
    expect(verdictCode('quiz')).toBe('quiz');
    expect(verdictText('quiz')).toBe('quiz');
  });

  it('статья с текстом: показывается текст, код остаётся кодом', () => {
    const item = { code: 'quiz', message: 'нет квиза по руне темы' };
    expect(verdictCode(item)).toBe('quiz');
    expect(verdictText(item)).toBe('нет квиза по руне темы');
  });

  it('статья без текста показывает код, а не пустоту', () => {
    expect(verdictText({ code: 'quiz' })).toBe('quiz');
    expect(verdictText({ code: 'quiz', message: '  ' })).toBe('quiz');
  });
});

describe('K5-VERDICT-CONTRACT · строка вердикта в паспорте', () => {
  it('провал показан текстом, код — в подсказке', () => {
    show({ score: 1, max: 2, failed: [{ code: 'quiz', message: 'нет квиза по руне темы' }], hints: [] });
    const pill = screen.getByText('нет квиза по руне темы');
    expect(pill.getAttribute('title')).toBe('quiz');
  });

  it('прежняя форма — список кодов — продолжает работать', () => {
    show({ score: 1, max: 2, failed: ['quiz'], hints: ['добавить пример'] });
    expect(screen.getByText('quiz')).toBeTruthy();
    expect(screen.getByText('добавить пример')).toBeTruthy();
  });

  it('«не смогли проверить» — отдельной группой, и это не «все проверки пройдены»', () => {
    show({ score: 2, max: 2, failed: [], hints: [], unknown: [{ code: 'pack', message: 'пак игры не прочитан' }] });
    expect(screen.getByText('Не смогли проверить')).toBeTruthy();
    expect(screen.getByText('пак игры не прочитан')).toBeTruthy();
    expect(screen.queryByText('Все проверки пройдены')).toBeNull();
  });

  it('запись без проверок: вердикт не задан — строки вердикта нет', () => {
    const { container } = show(undefined);
    expect(container.querySelector('[data-testid="kit-verdict"]')).toBeNull();
  });

  it('положительный контроль: всё пройдено — строка есть и говорит об этом', () => {
    show({ score: 2, max: 2, failed: [], hints: [] });
    expect(screen.getByText('Все проверки пройдены')).toBeTruthy();
  });
});

describe('K5-VERDICT-CONTRACT · тон вердикта', () => {
  it('полный счёт при «не смогли проверить» — не зелёный', () => {
    expect(verdictTone({ score: 2, max: 2, failed: [], hints: [] })).toBe('suc');
    expect(verdictTone({ score: 2, max: 2, failed: [], hints: [], unknown: ['pack'] })).toBe('wrn');
  });

  it('вердикта нет — нейтральный тон', () => {
    expect(verdictTone(undefined)).toBe('t3');
  });
});
