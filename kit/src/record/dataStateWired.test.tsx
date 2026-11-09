// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-30 — блок «Состояние данных» виден в записи.
//
// Поймал сторож `wired.test.ts`: `DataStateBlock` написан, покрыт своими
// тестами и НЕ вызывался ниоткуда — ни из kit, ни из приложения. То есть
// правило, на котором держится весь интерфейс («не смогли проверить» ≠
// «пусто»), в самой записи не работало: блок, который сервер не отдал,
// выглядел пустым, и человек делал выводы по неполным данным, не зная об этом.
//
// Чинится в kit, а не в приложении, намеренно: источник уже под рукой —
// `ctx.data.meta` приходит каждому, кто рисует запись, и подключать это
// вручную в каждом экране значит однажды забыть.
//
// Место выбрано над содержимым, не под ним: предупреждение, прочитанное после
// выводов, бесполезно.
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('mermaid', () => ({
  default: { registerLayoutLoaders: vi.fn(), initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) },
}));

import { RecordView } from './RecordView';
import type { KitCtx, KitMeta, KitRecord } from '../core/contract';

const record: KitRecord = { id: 'ADR-1', kind: 'Adr', title: 'Запись', status: 'todo', fields: {} };

const ctxWith = (meta: KitMeta): KitCtx => ({
  data: { records: [record], edges: [], journal: [], meta },
  config: {
    modules: [], menu: { groups: [] }, statuses: { items: [] },
    kinds: { Adr: { title: 'ADR', icon: 'scroll-quill', fields: [] } },
  },
  href: id => `#${id}`,
  esc: s => s,
  md: s => <span>{s}</span>,
});

const show = (meta: KitMeta) =>
  render(<RecordView record={record} ctx={ctxWith(meta)} tab="overview" onTab={() => {}} />);

const block = () => document.querySelector('.sk-ds');

describe('S4-30 · состояние данных видно в записи', () => {
  it('положительный контроль: запись рисуется', () => {
    show({ generated_at: '2026-11-09T00:00:00Z' });
    expect(document.querySelector('.sk-rec')).toBeTruthy();
  });

  it('сказать нечего — блока нет: пустая рамка «всё хорошо» приучает её не читать', () => {
    show({ generated_at: '2026-11-09T00:00:00Z' });
    expect(block()).toBeNull();
  });

  it('блок не прочитался — названы блок и причина, а не «пусто»', () => {
    show({ generated_at: '2026-11-09T00:00:00Z', errors: [{ block: 'links', reason: 'таймаут базы' }] });
    const b = block();
    expect(b).toBeTruthy();
    expect(b?.textContent).toContain('links');
    expect(b?.textContent).toContain('таймаут базы');
  });

  it('«нет прав» показано отдельно от сбоя — ждать нечего, надо просить доступ', () => {
    const meta = {
      generated_at: '2026-11-09T00:00:00Z',
      data_state: [{ source: 'journal', state: 'forbidden', reason: 'нет прав на журнал' }],
    } as unknown as KitMeta;
    show(meta);
    expect(document.querySelector('[data-testid="ds-forbidden"]')?.textContent).toContain('нет прав на журнал');
    expect(document.querySelector('[data-testid="ds-failed"]')).toBeNull();
  });

  it('обрезанная выдача названа числом сервера, а не выдуманным', () => {
    show({ generated_at: '2026-11-09T00:00:00Z', truncated: true, returned: 50, total: 318 });
    const b = document.querySelector('[data-testid="ds-truncated"]');
    expect(b?.textContent).toContain('50');
    expect(b?.textContent).toContain('318');
  });

  it('предупреждение стоит над содержимым записи, а не под ним', () => {
    show({ generated_at: '2026-11-09T00:00:00Z', errors: [{ block: 'links', reason: 'таймаут базы' }] });
    const ds = block()!;
    const tabs = document.querySelector('.sk-rec__tabs')!;
    // Node.DOCUMENT_POSITION_FOLLOWING: вкладки идут ПОСЛЕ блока состояния.
    expect(ds.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
