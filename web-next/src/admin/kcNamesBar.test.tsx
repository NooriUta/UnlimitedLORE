// @vitest-environment jsdom
// Пакет 1.18 — «Люди»: имена из KC при открытии раздела (раз в сутки) и кнопкой; итог и отказ — словами.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { KcNamesBar } from './KcNamesBar';

const res = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('KcNamesBar', () => {
  it('при открытии — сверка с окном в сутки; обновились имена — список перечитывается', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => res({ ok: true, skipped: false, updated: 2, no_name_in_kc: 1, manual_kept: 0, unchanged: 3 }));
    const onChanged = vi.fn();
    render(<KcNamesBar fetchImpl={f as unknown as typeof fetch} onChanged={onChanged} />);
    await waitFor(() => expect(screen.getByTestId('adm-kc-names-line').textContent).toContain('2'));
    expect(f.mock.calls[0][0]).toBe('/lore/kc/user-names/sync?if_older_than_hours=24');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('кнопка — сверка без окна', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => res({ ok: true, skipped: true, synced_at: '2026-11-21T09:00:00Z' }));
    render(<KcNamesBar fetchImpl={f as unknown as typeof fetch} onChanged={() => {}} />);
    await waitFor(() => expect(f).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('adm-kc-names-btn'));
    await waitFor(() => expect(f).toHaveBeenCalledTimes(2));
    expect(f.mock.calls[1][0]).toBe('/lore/kc/user-names/sync');
  });

  it('KC недоступен — строка с причиной, роль alert', async () => {
    const f = vi.fn(async (_url: string, _init?: RequestInit) => res({ error: 'KC_UPSTREAM', detail: 'kc users first=0 503' }, 502));
    render(<KcNamesBar fetchImpl={f as unknown as typeof fetch} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('503'));
  });
});
