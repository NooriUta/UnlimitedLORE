// @vitest-environment jsdom
// SPRINT_LORE_ADMIN_POLISH/AP-PEOPLE-PAGE · стенд-e2e RFD3 (run 11094): под test-viewer на карточке агента видна подпись
// поля «Учётка» — значение client_id сервер зрителю не отдаёт (решение 1б), а подпись с «—» оставалась.
//
// Корень: раздел «Агенты» (screens.ts, agentsSpec) зашивал поле clientId в «Свойства» карточки безусловно, а kit
// рисует каждое поле вида — пустое прочерком. Общее правило: поле, которое сервер отдаёт только с правом
// (restricted), без значения не рисуется — ни подписью, ни прочерком. Обычные поля пустыми по-прежнему видны «—».
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { KitLangProvider, RecordView, registerGameIcons, type KitCtx, type KitRecord } from '@seidr/kit';
import { LIST_SCREENS } from './screens';
import ru from '../i18n/ru.json';

beforeAll(() => registerGameIcons(gameIcons));

const def = LIST_SCREENS.agents;
const cfg = def.config('ru');
const row = { actor_id: 'AGENT-FULL-x', name: 'Claude Code (full)', agent_role: 'full', harness: 'claude', owner: 'sub-ann', owner_name: 'Ann So', projects: [] };

function card(rec: KitRecord) {
  const ctx: KitCtx = {
    data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-26T00:00:00Z' } },
    config: cfg,
    href: id => `?sec=agent&open=${encodeURIComponent(id)}`, esc: s => s, md: s => <div>{s}</div>,
  };
  return render(<KitLangProvider lang="ru"><RecordView record={rec} ctx={ctx} tab="props" onTab={() => {}} /></KitLangProvider>);
}

describe('AP-PEOPLE-PAGE · карточка агента: «Учётка» только со значением', () => {
  it('зрителю client_id не отдан — подписи «Учётка» на карточке нет', () => {
    card(def.map({ ...row, client_id: null }));
    expect(screen.getByText(ru['lists.field.agentRole']), 'положительный контроль: свойства карточки нарисованы').toBeTruthy();
    expect(screen.queryByText(ru['lists.field.clientId'])).toBeNull();
  });

  it('админу client_id отдан — поле на месте со значением', () => {
    card(def.map({ ...row, client_id: 'lore-mcp-full' }));
    expect(screen.getByText(ru['lists.field.clientId'])).toBeTruthy();
    expect(screen.getAllByText('lore-mcp-full').length).toBeGreaterThan(0);
  });

  it('обычное поле без значения — по-прежнему прочерком (правило только для полей с правом)', () => {
    card(def.map({ ...row, client_id: 'lore-mcp-full', harness: null }));
    expect(screen.getByText(ru['lists.field.harness'])).toBeTruthy();
  });
});
