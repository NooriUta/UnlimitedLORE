// @vitest-environment jsdom
// SPRINT_UXR_S13_KIT4/K4-SUMMARY-QUEUE — сводка по вердикту (первая часть задачи: отображение).
//
// Пилот «Дата-странников»: карточка на каждый вид записей — «прошло N из M», полоска; провалы —
// по причинам со счётом; клик по причине открывает список, отфильтрованный этой проверкой
// (K4-VERDICT-FILTER). Правило: число в карточке обязано совпасть с «Показано N» в списке, куда
// она ведёт. Считает вердикт приложение, kit только рисует. Выдача обрезана — «итоги неполные».
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitCtx, KitRecord, KitVerdict } from '../core/contract';
import { applyCheck } from './listModel';
import { VerdictSummary, summarizeVerdicts } from './VerdictSummary';

const rec = (id: string, kind: string): KitRecord => ({ id, kind, title: id, status: '', fields: {} });
const RECORDS = [rec('t1', 'topic'), rec('t2', 'topic'), rec('t3', 'topic'), rec('q1', 'quiz'), rec('r1', 'rule')];
const V: Record<string, KitVerdict | undefined> = {
  t1: { score: 1, max: 2, failed: [{ code: 'quiz', message: 'нет квиза по руне темы' }], hints: [] },
  t2: { score: 1, max: 2, failed: [{ code: 'quiz', message: 'нет квиза по руне темы' }], hints: [{ code: 'art', message: 'нет рисунка' }] },
  t3: { score: 2, max: 2, failed: [], hints: [] },
  q1: { score: 1, max: 1, failed: [], hints: [], unknown: [{ code: 'pack', message: 'пак не прочитан' }] },
  r1: undefined,
};
const verdictOf = (r: KitRecord) => V[r.id];
const config = {
  kinds: { topic: { title: 'Темы', icon: 'scroll-unfurled' }, quiz: { title: 'Квизы', icon: 'checkbox-tree' }, rule: { title: 'Правила', icon: 'gears' } },
  verdict: verdictOf,
} as unknown as KitConfig;
const ctx = { config } as unknown as KitCtx;
const href = (kind: string, check?: string) => `?sec=${kind}${check ? `&lck=${check}` : ''}`;

describe('K4-SUMMARY-QUEUE · счёт сводки', () => {
  const s = summarizeVerdicts(RECORDS, verdictOf);

  it('по каждому виду: всего, с проверками, прошло', () => {
    const topic = s.find(x => x.kind === 'topic')!;
    expect(topic).toMatchObject({ total: 3, checked: 3, passed: 1 });
  });

  it('вид без проверок не выдан за «всё прошло»: checked = 0', () => {
    expect(s.find(x => x.kind === 'rule')).toMatchObject({ total: 1, checked: 0, passed: 0 });
  });

  it('«не смогли проверить» не считается пройденным', () => {
    expect(s.find(x => x.kind === 'quiz')).toMatchObject({ total: 1, checked: 1, passed: 0 });
  });

  it('число у причины равно числу записей в списке под тем же условием', () => {
    for (const g of s) {
      const own = RECORDS.filter(r => r.kind === g.kind);
      for (const c of g.checks) expect(applyCheck(own, c, verdictOf), `${g.kind} ${c.kind}:${c.code}`).toHaveLength(c.n);
    }
  });
});

describe('K4-SUMMARY-QUEUE · карточки сводки', () => {
  it('карточка вида: «прошло 1 из 3» и причины со счётом и текстом', () => {
    render(<VerdictSummary records={RECORDS} ctx={ctx} lang="ru" hrefOf={href} />);
    const card = screen.getByTestId('kit-vsum-topic');
    expect(card.textContent).toContain('Темы');
    expect(card.textContent).toContain('1 из 3');
    expect(within(card).getByText('нет квиза по руне темы')).toBeTruthy();
    expect(card.textContent).toContain('2');
  });

  it('причина — ссылка в список с этим условием', () => {
    render(<VerdictSummary records={RECORDS} ctx={ctx} lang="ru" hrefOf={href} />);
    const link = within(screen.getByTestId('kit-vsum-topic')).getByText('нет квиза по руне темы').closest('a');
    expect(link?.getAttribute('href')).toBe('?sec=topic&lck=fail:quiz');
  });

  it('у вида без проверок сказано «проверок нет», а не «прошло 0 из 1»', () => {
    render(<VerdictSummary records={RECORDS} ctx={ctx} lang="ru" hrefOf={href} />);
    const card = screen.getByTestId('kit-vsum-rule');
    expect(card.textContent).toContain('Проверок нет');
    expect(card.textContent).not.toContain('0 из 1');
  });

  it('выдача обрезана — плашка «итоги неполные»', () => {
    render(<VerdictSummary records={RECORDS} ctx={ctx} lang="ru" hrefOf={href} truncated />);
    expect(screen.getByRole('status').textContent).toContain('неполные');
  });

  it('записей нет — пустое состояние словами, а не пустая рамка', () => {
    render(<VerdictSummary records={[]} ctx={ctx} lang="ru" hrefOf={href} />);
    expect(screen.getByTestId('kit-vsum-empty')).toBeTruthy();
  });

  it('вердикт на экране не считается — так и сказано, карточек с нулями нет', () => {
    const noVerdict = { config: { kinds: config.kinds } } as unknown as KitCtx;
    render(<VerdictSummary records={RECORDS} ctx={noVerdict} lang="ru" hrefOf={href} />);
    expect(screen.getByTestId('kit-vsum-off')).toBeTruthy();
    expect(screen.queryByTestId('kit-vsum-topic')).toBeNull();
  });
});

// Находки пилота 15.11.2026 (696ed81e, проход UI/UX 6a0c66d6): «Темы 11 из 181» стояла на телефоне
// двенадцатой, а переход по ссылке сводки перезагружал страницу и заново тянул 915 КБ данных.
describe('K4-SUMMARY-QUEUE · порядок по тяжести и переход без перезагрузки', () => {
  it('сначала худшая доля пройденных, виды без проверок — в конец, при равенстве — порядок появления', () => {
    const recs = [rec('a1', 'good'), rec('r1', 'rule'), rec('b1', 'bad'), rec('b2', 'bad'), rec('m1', 'mid'), rec('m2', 'mid'), rec('c1', 'tie')];
    const VV: Record<string, KitVerdict | undefined> = {
      a1: { score: 1, max: 1, failed: [], hints: [] },
      b1: { score: 0, max: 1, failed: [{ code: 'x', message: 'x' }], hints: [] },
      b2: { score: 0, max: 1, failed: [{ code: 'x', message: 'x' }], hints: [] },
      m1: { score: 1, max: 1, failed: [], hints: [] },
      m2: { score: 0, max: 1, failed: [{ code: 'x', message: 'x' }], hints: [] },
      c1: { score: 1, max: 1, failed: [], hints: [] },
    };
    expect(summarizeVerdicts(recs, r => VV[r.id]).map(g => g.kind)).toEqual(['bad', 'mid', 'good', 'tie', 'rule']);
  });

  it('onNavigate: обычный щелчок уходит приложению, ссылка остаётся ссылкой', () => {
    const calls: [string, string | undefined][] = [];
    render(<VerdictSummary records={RECORDS} ctx={ctx} lang="ru" hrefOf={href} onNavigate={(k, c) => calls.push([k, c])} />);
    const link = within(screen.getByTestId('kit-vsum-topic')).getByText('нет квиза по руне темы').closest('a')!;
    expect(link.getAttribute('href')).toBe('?sec=topic&lck=fail:quiz');
    const plain = fireEvent.click(link);
    expect(plain).toBe(false); // переход браузера отменён
    expect(calls).toEqual([['topic', 'fail:quiz']]);
  });

  it('щелчок с Ctrl (новая вкладка) не перехватывается', () => {
    const calls: unknown[] = [];
    render(<VerdictSummary records={RECORDS} ctx={ctx} lang="ru" hrefOf={href} onNavigate={(k, c) => calls.push([k, c])} />);
    const head = within(screen.getByTestId('kit-vsum-topic')).getByText('Темы').closest('a')!;
    fireEvent.click(head, { ctrlKey: true });
    expect(calls).toEqual([]);
    fireEvent.click(head);
    expect(calls).toEqual([['topic', undefined]]);
  });
});
