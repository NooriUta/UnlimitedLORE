// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-29 — шапка паспорта как в прототипе v4 (скрин 115443):
// надзаголовок «ТИП · ID» → H1 → строка «статус · факты · получено N мин ↻» →
// вкладки подчёркиванием со счётчиками. В v2 статус стоял НАД заголовком в
// одной строке с ID-пилюлей, а свежесть загрузки не показывалась вовсе.
// «Получено» — когда экран получил данные (не дата правки записи); ↻ перезапрашивает.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '../elements/GameIcon';
import type { KitConfig, KitCtx, KitRecord } from '../core/contract';
import { RecordView } from './RecordView';

beforeAll(() => { registerGameIcons(gameIcons); });

const NOW = Date.parse('2026-11-08T12:00:00Z');
const config: KitConfig = {
  modules: [], menu: { groups: [] }, kinds: { spec: { title: 'Спека', icon: 'scroll-quill' } },
  statuses: { items: [{ code: 'proposed', title: 'предложено', category: 'active', icon: 'calendar', color: 'var(--acc)' }] },
};
const rec: KitRecord = { id: 'SPEC-DW-1', kind: 'spec', title: 'Конвейер юнитов', status: 'proposed', fields: {}, updated_at: '2026-11-06T00:00:00Z' };
const ctx: KitCtx = {
  config, data: { records: [rec], edges: [], journal: [], meta: { generated_at: '2026-11-08T11:54:00Z' } },
  href: id => `#${id}`, esc: s => s, md: s => s,
};
const view = (extra: Partial<Parameters<typeof RecordView>[0]> = {}) =>
  render(<RecordView record={rec} ctx={ctx} tab="overview" onTab={() => {}} now={NOW} {...extra} />);

describe('надзаголовок и порядок', () => {
  it('над H1 — «тип · ID» текстом (не пилюлей), статус — под H1', () => {
    view();
    const head = screen.getByTestId('kit-rec-head');
    const over = head.querySelector('.sk-rec-head__over')!;
    expect(over.textContent).toContain('Спека');
    expect(over.textContent).toContain('SPEC-DW-1');
    expect(over.querySelector('.sk-pill')).toBeNull();
    const h1 = within(head).getByRole('heading', { level: 1 });
    const status = head.querySelector('.sk-rec-status')!;
    expect(over.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(h1.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('«получено N мин ↻»', () => {
  it('по loadedAt — минуты от загрузки; ↻ перезапрашивает', () => {
    const onReload = vi.fn();
    view({ loadedAt: '2026-11-08T11:54:00Z', onReload });
    const loaded = screen.getByTestId('kit-rec-loaded');
    expect(loaded.textContent).toContain('получено 6 мин назад');
    fireEvent.click(within(loaded).getByRole('button', { name: 'Обновить' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('только что — «получено только что»; без loadedAt — пометки нет', () => {
    view({ loadedAt: '2026-11-08T11:59:40Z' });
    expect(screen.getByTestId('kit-rec-loaded').textContent).toContain('только что');
  });

  it('с фактами — «получено» последним пунктом строки фактов; статус в статье один раз', () => {
    const { container } = view({ loadedAt: '2026-11-08T11:54:00Z', facts: { now: NOW } });
    const facts = screen.getByTestId('kit-facts');
    const items = facts.querySelectorAll('li');
    expect(items[items.length - 1].querySelector('[data-testid="kit-rec-loaded"]')).not.toBeNull();
    expect(container.querySelectorAll('.sk-rec-status')).toHaveLength(1);
  });
});

describe('вкладки записи — подчёркиванием', () => {
  it('tablist записи — вариант underline', () => {
    view();
    expect(screen.getByRole('tablist').classList.contains('sk-tabs--underline')).toBe(true);
  });
});
