// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE · поле с правом (restricted): значение сервер отдаёт только тому, у кого есть
// право (учётка агента — администратору). Пусто — строки поля нет вовсе: подпись с «—» выдавала бы, что поле есть,
// но скрыто. Обычное пустое поле — прочерком, как прежде.
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';
import { KitLangProvider } from '../i18n/lang';

const cfg = {
  kinds: { agent: { title: 'Агенты', icon: 'robot-golem', fields: [
    { key: 'account', title: 'Учётка', type: 'text', restricted: true },
    { key: 'role', title: 'Профиль', type: 'text' },
  ] } },
  statuses: { items: [] },
} as unknown as KitCtx['config'];

function card(fields: Record<string, unknown>) {
  const rec: KitRecord = { id: 'A-1', kind: 'agent', title: 'Агент', status: '', fields };
  const ctx = { data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-26T00:00:00Z' } }, config: cfg, href: (id: string) => `#${id}`, esc: (s: string) => s, md: (s: string) => s } as unknown as KitCtx;
  return render(<KitLangProvider lang="ru"><RecordView record={rec} ctx={ctx} tab="props" onTab={() => {}} /></KitLangProvider>);
}

describe('AP-PEOPLE-PAGE · поле с правом', () => {
  it('без значения — ни подписи, ни прочерка; обычное пустое поле — прочерком', () => {
    card({ account: '', role: '' });
    expect(screen.queryByText('Учётка')).toBeNull();
    expect(screen.getByText('Профиль')).toBeTruthy();
  });

  it('со значением — поле на месте', () => {
    card({ account: 'lore-mcp-full', role: 'full' });
    expect(screen.getByText('Учётка')).toBeTruthy();
    expect(screen.getByText('lore-mcp-full')).toBeTruthy();
  });
});
