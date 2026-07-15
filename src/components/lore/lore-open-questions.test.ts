import { describe, expect, it } from 'vitest';
import { isOverdue } from './LoreOpenQuestionsBoard';

// Overdue is a derived signal (ADR-021 §SCD2): open ∧ due_date < today. Only
// open questions can be overdue — a closed/deferred one past its date is not.
describe('isOverdue', () => {
  const today = '2026-07-16';

  it('open + past due_date = overdue', () => {
    expect(isOverdue({ status: 'open', due_date: '2026-07-10' }, today)).toBe(true);
  });

  it('open + future due_date = not overdue', () => {
    expect(isOverdue({ status: 'open', due_date: '2026-08-01' }, today)).toBe(false);
  });

  it('open + no due_date = not overdue', () => {
    expect(isOverdue({ status: 'open', due_date: null }, today)).toBe(false);
  });

  it('closed past due_date is NOT overdue (only open counts)', () => {
    expect(isOverdue({ status: 'closed', due_date: '2026-07-10' }, today)).toBe(false);
  });

  it('deferred past due_date is NOT overdue', () => {
    expect(isOverdue({ status: 'deferred', due_date: '2026-07-10' }, today)).toBe(false);
  });

  it('due_date exactly today is not overdue (strictly before)', () => {
    expect(isOverdue({ status: 'open', due_date: '2026-07-16' }, today)).toBe(false);
  });
});
