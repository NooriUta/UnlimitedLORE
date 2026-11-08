import { describe, expect, it } from 'vitest';
import { bodyStateOf, canEditBody } from './bodyState';

// SPRINT_UXR_S1_HONEST_API/S1-05 (B-04). Бэкенд обнуляет тело записи, если у
// читателя нет роли ни в одном её проекте, и ставит body_redacted + причину
// (AidaLoreResource.redactIfNoRole). Экран рисовал такое тело как «Контент
// пуст.» — «нет доступа» было неотличимо от «не написано». Правило: у тела три
// исхода, и «пусто» — только когда признака скрытия нет.
describe('тело записи: скрыто правами ≠ пусто', () => {
  const FIELDS = ['content_md', 'content_html'] as const;
  type Row = {
    content_md?: string | null; content_html?: string | null;
    body_redacted?: boolean | null; body_redacted_reason?: string | null;
  };
  const st = (r: Row) => bodyStateOf(r, FIELDS);

  it('тело есть — present', () => {
    expect(st({ content_md: '# x' })).toEqual({ k: 'present' });
  });

  it('тела нет и признака нет — empty', () => {
    expect(st({ content_md: null, content_html: '' })).toEqual({ k: 'empty' });
  });

  it('тело обнулено правами — redacted с причиной от бэкенда', () => {
    expect(st({ content_md: null, body_redacted: true, body_redacted_reason: 'нет роли' }))
      .toEqual({ k: 'redacted', reason: 'нет роли' });
  });

  it('признак без причины — всё равно redacted, причина null', () => {
    expect(st({ content_md: null, body_redacted: true })).toEqual({ k: 'redacted', reason: null });
  });

  it('признак важнее остатков тела: скрытое не выдаётся за написанное', () => {
    expect(st({ content_md: 'x', body_redacted: true }).k).toBe('redacted');
  });

  it('пробельная причина не считается причиной', () => {
    expect(st({ body_redacted: true, body_redacted_reason: '  ' })).toEqual({ k: 'redacted', reason: null });
  });

  it('body_redacted=false — обычная проверка тела', () => {
    expect(st({ content_md: '', body_redacted: false }).k).toBe('empty');
  });
});

// Правка скрытого тела стартовала бы с пустого черновика, и «Сохранить»
// затёрло бы настоящее содержимое пустой строкой.
describe('скрытое тело не редактируется', () => {
  it('redacted — правка закрыта', () => {
    expect(canEditBody({ k: 'redacted', reason: null })).toBe(false);
  });
  it('present/empty — правка открыта', () => {
    expect(canEditBody({ k: 'present' })).toBe(true);
    expect(canEditBody({ k: 'empty' })).toBe(true);
  });
});

// Обе вьюхи, у которых бэкенд обнуляет тело (spec_by_id, doc_by_id,
// runbook_by_id — LoreSlices.BODY_SCOPED), обязаны спрашивать bodyStateOf, а не
// судить по пустоте поля.
const VIEWS = import.meta.glob(['./LoreSpecView.tsx', './LoreArtifactDoc.tsx'],
  { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('вьюхи тел учитывают скрытие', () => {
  for (const f of ['./LoreSpecView.tsx', './LoreArtifactDoc.tsx']) {
    it(f, () => {
      const src = VIEWS[f];
      expect(src).toBeTypeOf('string');
      expect(src).toMatch(/bodyStateOf\(/);
      expect(src).toMatch(/<RedactedBody\b/);
    });
  }
});
