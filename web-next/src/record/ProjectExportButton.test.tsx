// @vitest-environment jsdom
// SPRINT_LORE_MD_ARCHIVE/MDA-04 — «Выгрузить в MD» в паспорте проекта. С телефона и из
// браузера MCP недоступен, нужна кнопка. Ошибки — словами: 403 «нет прав на проект»,
// прочее — «выгрузка не удалась»; пустой файл вместо ошибки не скачивается.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectExportButton } from './ProjectExportButton';

const zipResponse = () => new Response(new Uint8Array([80, 75, 3, 4]), {
  status: 200, headers: { 'Content-Type': 'application/zip' },
});

describe('MDA-04 · кнопка «Выгрузить в MD»', () => {
  it('скачивает zip выгрузки проекта по адресу сервера', async () => {
    const fetchImpl = vi.fn(async () => zipResponse()) as unknown as typeof fetch;
    const save = vi.fn();
    render(<ProjectExportButton slug="NooriUta/UnlimitedLORE" fetchImpl={fetchImpl} save={save} />);
    fireEvent.click(screen.getByTestId('project-export'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('/lore/export/project/NooriUta/UnlimitedLORE');
    const [blob, name] = save.mock.calls[0];
    expect(name).toBe('NooriUta__UnlimitedLORE.zip');
    expect((blob as Blob).size).toBe(4);
  });

  it('403 — «нет прав на проект», загрузка не запускается', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'PROJECT_FORBIDDEN' }), { status: 403 })) as unknown as typeof fetch;
    const save = vi.fn();
    render(<ProjectExportButton slug="O/R" fetchImpl={fetchImpl} save={save} />);
    fireEvent.click(screen.getByTestId('project-export'));
    expect((await screen.findByTestId('project-export-error')).textContent).toMatch(/нет прав/i);
    expect(save).not.toHaveBeenCalled();
  });

  it('5xx — «выгрузка не удалась» с кодом, загрузка не запускается', async () => {
    const fetchImpl = vi.fn(async () => new Response('boom', { status: 502 })) as unknown as typeof fetch;
    const save = vi.fn();
    render(<ProjectExportButton slug="O/R" fetchImpl={fetchImpl} save={save} />);
    fireEvent.click(screen.getByTestId('project-export'));
    expect((await screen.findByTestId('project-export-error')).textContent).toMatch(/не удалась.*502/i);
    expect(save).not.toHaveBeenCalled();
  });
});
