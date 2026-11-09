// @vitest-environment jsdom
// SPRINT_UXR_S5_RECORD_TASKS/S5-09 — черновик правки и «Восстановить черновик
// от HH:MM».
//
// Повод: несохранённая правка не должна пропадать. Серверная часть влита
// (PR #940): GET/POST /lore/me/drafts, один черновик на поле, `saved_at` —
// ровно для подписи «от HH:MM», `base_version` — версия записи на момент
// начала правки.
//
// kit про API не знает: он получает слот из трёх действий (прочитать,
// сохранить, снять). Это та же развязка, что у onSave.
//
// Что закрепляется и почему:
//   • предложение восстановить видно СРАЗУ при открытии записи, а не после
//     входа в правку: иначе про черновик узнаёт только тот, кто и так собрался
//     править;
//   • черновик, совпадающий с текстом записи, не предлагается — предлагать
//     нечего;
//   • `base_version` разошёлся (запись правили после черновика) — предложение
//     остаётся, но с честной пометкой: слияние по блокам это S5-08, и молча
//     наложить старый текст на новую запись нельзя;
//   • черновик сохраняется с паузой, а не на каждую букву;
//   • после сохранения записи черновик снимается — иначе он будет всплывать
//     поверх уже сохранённого текста;
//   • «черновик не прочитан» ≠ «черновика нет», «черновик не сохранён» ≠
//     «сохранён»: оба сбоя названы словами, а не проглочены.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MdInlineEdit } from './MdInlineEdit';

const SAVED_AT = '2026-11-09T07:05:00Z';
const hhmm = new Date(SAVED_AT).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

interface SlotOpts {
  draft?: { text: string; savedAt: string; stale?: boolean } | null;
  loadFails?: boolean;
  saveFails?: boolean;
}

function slot(opts: SlotOpts = {}) {
  const save = vi.fn(async () => { if (opts.saveFails) throw new Error('сеть'); });
  const remove = vi.fn(async () => {});
  const load = vi.fn(async () => {
    if (opts.loadFails) throw new Error('503');
    return opts.draft ?? null;
  });
  return { load, save, remove, delayMs: 20 };
}

/** Поле исходника: правка идёт в коде — по роли textbox в превью отвечает TipTap. */
const src = () => screen.getByLabelText(/исходник markdown/) as HTMLTextAreaElement;
const srcAsync = () => screen.findByLabelText(/исходник markdown/);

const show = (s: ReturnType<typeof slot>, onSave = vi.fn(async () => {})) => ({
  onSave,
  ...render(<MdInlineEdit value="Текст записи" label="Тело" onSave={onSave} drafts={s} defaultMode="code" />),
});

describe('S5-09 · предложение восстановить черновик', () => {
  it('положительный контроль: без черновика ничего не предлагается', async () => {
    const s = slot({ draft: null });
    show(s);
    await waitFor(() => expect(s.load).toHaveBeenCalled());
    expect(screen.queryByText(/Восстановить черновик/)).toBeNull();
  });

  it('черновик есть — предложение видно сразу, со временем сохранения', async () => {
    show(slot({ draft: { text: 'Недописанное', savedAt: SAVED_AT } }));
    const bar = await screen.findByRole('status');
    expect(bar.textContent).toMatch(/Восстановить черновик/);
    expect(bar.textContent).toContain(hhmm);
  });

  it('«Восстановить» открывает правку с текстом черновика, а не записи', async () => {
    show(slot({ draft: { text: 'Недописанное', savedAt: SAVED_AT } }));
    fireEvent.click(await screen.findByRole('button', { name: 'Восстановить' }));
    const area = await srcAsync();
    expect((area as HTMLTextAreaElement).value).toBe('Недописанное');
  });

  it('«Отбросить» снимает черновик на сервере и убирает предложение', async () => {
    const s = slot({ draft: { text: 'Недописанное', savedAt: SAVED_AT } });
    show(s);
    fireEvent.click(await screen.findByRole('button', { name: 'Отбросить' }));
    await waitFor(() => expect(s.remove).toHaveBeenCalled());
    expect(screen.queryByText(/Восстановить черновик/)).toBeNull();
  });

  it('черновик совпадает с записью — предлагать нечего', async () => {
    const s = slot({ draft: { text: 'Текст записи', savedAt: SAVED_AT } });
    show(s);
    await waitFor(() => expect(s.load).toHaveBeenCalled());
    expect(screen.queryByText(/Восстановить черновик/)).toBeNull();
  });

  it('запись правили после черновика — предложение с честной пометкой', async () => {
    show(slot({ draft: { text: 'Недописанное', savedAt: SAVED_AT, stale: true } }));
    const bar = await screen.findByRole('status');
    expect(bar.textContent).toMatch(/Восстановить черновик/);
    expect(bar.textContent).toMatch(/изменили/);
  });

  it('черновик не прочитан — это сказано, а не принято за «черновика нет»', async () => {
    show(slot({ loadFails: true }));
    expect((await screen.findByRole('status')).textContent).toMatch(/черновик не прочитан/i);
  });
});

describe('S5-09 · сохранение черновика', () => {
  it('черновик сохраняется с паузой, а не на каждую букву', async () => {
    vi.useFakeTimers();
    try {
      const s = slot();
      render(<MdInlineEdit value="Текст записи" label="Тело" onSave={async () => {}} drafts={s} defaultMode="code" />);
      fireEvent.click(screen.getByRole('button', { name: /Править/ }));
      const area = src();
      fireEvent.change(area, { target: { value: 'Текст записи и' } });
      fireEvent.change(area, { target: { value: 'Текст записи и ещё' } });
      expect(s.save).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
      expect(s.save).toHaveBeenCalledTimes(1);
      expect(s.save).toHaveBeenCalledWith('Текст записи и ещё');
    } finally {
      vi.useRealTimers();
    }
  });

  it('текст вернули к записи — черновик снимается, а не хранится пустым', async () => {
    vi.useFakeTimers();
    try {
      const s = slot();
      render(<MdInlineEdit value="Текст записи" label="Тело" onSave={async () => {}} drafts={s} defaultMode="code" />);
      fireEvent.click(screen.getByRole('button', { name: /Править/ }));
      const area = src();
      fireEvent.change(area, { target: { value: 'Иначе' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
      fireEvent.change(area, { target: { value: 'Текст записи' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
      expect(s.remove).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('после сохранения записи черновик снимается', async () => {
    const s = slot();
    const onSave = vi.fn(async () => {});
    render(<MdInlineEdit value="Текст записи" label="Тело" onSave={onSave} drafts={s} defaultMode="code" />);
    fireEvent.click(screen.getByRole('button', { name: /Править/ }));
    fireEvent.change(src(), { target: { value: 'Новое тело' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('Новое тело'));
    await waitFor(() => expect(s.remove).toHaveBeenCalled());
  });

  it('черновик не сохранился — сказано словами, текст остаётся в поле', async () => {
    vi.useFakeTimers();
    try {
      const s = slot({ saveFails: true });
      render(<MdInlineEdit value="Текст записи" label="Тело" onSave={async () => {}} drafts={s} defaultMode="code" />);
      fireEvent.click(screen.getByRole('button', { name: /Править/ }));
      fireEvent.change(src(), { target: { value: 'Недописанное' } });
      await act(async () => { await vi.advanceTimersByTimeAsync(40); });
      expect(screen.getByText(/черновик не сохранён/i)).toBeTruthy();
      expect((src() as HTMLTextAreaElement).value).toBe('Недописанное');
    } finally {
      vi.useRealTimers();
    }
  });

  it('слота черновиков нет — поле работает как раньше, без лишних вызовов', () => {
    render(<MdInlineEdit value="Текст записи" label="Тело" onSave={async () => {}} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: /Править/ })).toBeTruthy();
  });
});
