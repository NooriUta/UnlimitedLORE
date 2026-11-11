// @vitest-environment jsdom
// Ссылка [[…]] в ЧТЕНИИ ведёт в паспорт записи (SPRINT_UXR_S10_SEIDR_KIT_2/MD-READ-PEEK,
// D-2026-LORE-MD-REF-EDIT-IN-PASSPORT: «попап паспорта или переход»). Адрес даёт приложение:
// kit не знает, где у записи паспорт. Нет адреса — остаётся рамка без ссылки, а не выдуманный href.
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { MartProse } from './MartProse';

describe('MartProse refHref', () => {
  it('адрес есть — рамка становится ссылкой <a href> с тем же текстом и классом', () => {
    const refHref = vi.fn((r: { id: string; type: string | null }) => (r.id === 'ADR-1' ? `/?sec=adrs&open=${r.id}` : null));
    const { container } = render(<MartProse text="см. [[adr:ADR-1]] и [[X-9]]" refHref={refHref} />);
    const a = container.querySelector('a.sk-wref') as HTMLAnchorElement | null;
    expect(a?.getAttribute('href')).toBe('/?sec=adrs&open=ADR-1');
    expect(a?.textContent).toBe('ADR-1');
    expect(a?.getAttribute('data-ref-type')).toBe('adr');
    expect(refHref).toHaveBeenCalledWith({ id: 'ADR-1', type: 'adr' });
    expect(refHref).toHaveBeenCalledWith({ id: 'X-9', type: null });
  });
  it('адреса нет — остаётся рамка-span, ссылки не выдумываем', () => {
    const { container } = render(<MartProse text="см. [[X-9]]" refHref={() => null} />);
    expect(container.querySelector('a.sk-wref')).toBeNull();
    expect(container.querySelector('span.sk-wref')?.textContent).toBe('X-9');
  });
  it('без refHref — как раньше, только рамки', () => {
    const { container } = render(<MartProse text="см. [[adr:ADR-1]]" />);
    expect(container.querySelector('a.sk-wref')).toBeNull();
    expect(container.querySelector('span.sk-wref')).toBeTruthy();
  });
  it('внутри кода ссылкой не становится', () => {
    const { container } = render(<MartProse text="`[[adr:ADR-1]]`" refHref={() => '/x'} />);
    expect(container.querySelector('a.sk-wref')).toBeNull();
  });
});

describe('MdInlineEdit пробрасывает refHref в чтение', () => {
  it('тело поля с правкой: ссылка ведёт в паспорт', async () => {
    const { MdInlineEdit } = await import('./MdInlineEdit');
    const { container } = render(<MdInlineEdit value="см. [[adr:ADR-1]]" label="Описание" onSave={() => {}} refHref={() => '/p/ADR-1'} />);
    expect(container.querySelector('a.sk-wref')?.getAttribute('href')).toBe('/p/ADR-1');
  });
});
