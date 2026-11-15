// @vitest-environment jsdom
// PU-29 (приёмка владелицы 14.11.2026, SPRINT_UXR_POLISH_UAT_1113/PU-29): статус в шапке паспорта —
// значком, как в списке (#1387): название не печатается строкой, а читается подсказкой и
// именем для экранного чтения. Значки — те же, что владелица выбрала для статусов (S4-25/S4-32):
// шапка берёт icon из словаря статусов, своих не заводит.
//
// Правило одно для обоих вариантов слота: кнопка (права есть) и плашка (прав нет).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordHead } from './RecordHead';
import { RecordFacts } from './RecordFacts';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';

const record: KitRecord = { id: 'SPRINT_X/CO-11', kind: 'task', title: 'Задача', status: 'progress', fields: {} };

function ctxOf(canStatus: boolean): KitCtx {
  const config = {
    modules: [{ id: 'm', title: 'M', icon: 'sprint', status: 'active' }],
    menu: { groups: [] },
    kinds: { task: { title: 'Задача', icon: 'sprint' } },
    statuses: { items: [{ code: 'progress', title: 'В работе', category: 'active', icon: 'sprint', color: 'var(--st-progress)' }] },
    roles: { reader: { canEdit: canStatus, canStatus } },
  } as unknown as KitConfig;
  return {
    config, role: 'reader',
    data: { records: [record], edges: [], journal: [], meta: { generated_at: '2026-11-15T00:00:00Z' } },
    href: (x: string) => `#${x}`, esc: (s: string) => s, md: (s: string) => s,
  } as KitCtx;
}

describe('PU-29: статус в шапке паспорта — значком, название в подсказке', () => {
  for (const canStatus of [true, false]) {
    const variant = canStatus ? 'кнопка (права есть)' : 'плашка (прав нет)';

    it(`шапка, ${variant}: название не печатается строкой, но доступно подсказкой`, () => {
      const { container } = render(<RecordHead record={record} ctx={ctxOf(canStatus)} lang="ru" titleId="t" />);
      const slot = container.querySelector('.sk-rec-head__status .sk-rec-status');
      expect(slot).not.toBeNull();
      // Положительный контроль: значок статуса нарисован.
      expect(slot!.querySelector('.sk-icon')).not.toBeNull();
      expect(slot!.textContent?.trim()).toBe('');
      expect(screen.getByTitle(/В работе/)).toBeTruthy();
    });

    it(`строка фактов, ${variant}: тот же значок без подписи`, () => {
      const { container } = render(<RecordFacts record={record} ctx={ctxOf(canStatus)} spec={{}} lang="ru" />);
      const slot = container.querySelector('.sk-rec-status');
      expect(slot).not.toBeNull();
      expect(slot!.textContent?.trim()).toBe('');
      expect(screen.getByTitle(/В работе/)).toBeTruthy();
    });
  }
});
