// @vitest-environment jsdom
// AP-PASSPORT-EDIT, волна 1 — черновик в доке: код из названия (2б) и проверка занятости ДО записи;
// «+ боль» из вкладки фичи (1б) — после записи связь ставится сама.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { RecordCreate } from './RecordCreateDock';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const wait = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)); });

function net(taken: string[]) {
  const posts: { url: string; body: unknown }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') { posts.push({ url, body: JSON.parse(String(init.body)) }); return json(200, { ok: true }); }
    const m = url.match(/^\/lore\/record\/\w+\/(.+)$/);
    if (m) return taken.includes(decodeURIComponent(m[1])) ? json(200, { record: {} }) : json(404, { error: 'NOT_FOUND' });
    return json(200, { rows: [], items: [] });
  }) as unknown as typeof fetch;
  return { impl, posts };
}

describe('AP-PASSPORT-EDIT · черновик боли', () => {
  it('код предложен из названия; занятый — сказано словами, «Сохранить» неактивна', async () => {
    const n = net(['PAIN-SYROY-TOKEN']);
    render(<RecordCreate type="pain" fetchImpl={n.impl} onCreated={() => {}} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'Сырой токен' } });
    expect((screen.getByLabelText(/^Код/) as HTMLInputElement).value).toBe('PAIN-SYROY-TOKEN');
    await wait(450);
    expect(screen.getByTestId('kit-create-check').textContent).toMatch(/Код занят/);
    expect((screen.getByRole('button', { name: 'Сохранить' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('«+ боль» из фичи: код свободен — запись mode=create, затем связь ADDRESSES со стороны фичи', async () => {
    const n = net([]);
    const onCreated = vi.fn();
    render(<RecordCreate type="pain" fetchImpl={n.impl} onCreated={onCreated} onCancel={() => {}}
      link={{ type: 'feature', id: 'FEAT-A', rel: 'ADDRESSES', dir: 'out' }} />);
    expect(screen.getByTestId('create-linked-note').textContent).toContain('FEAT-A');
    fireEvent.change(screen.getByLabelText(/^Название/), { target: { value: 'Боль' } });
    await wait(450);
    expect(screen.getByTestId('kit-create-check').textContent).toMatch(/свободен/);
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    await wait(10);
    expect(n.posts.map(p => p.url)).toEqual(['/lore/pain?mode=create', '/lore/record/feature/FEAT-A/relation']);
    expect(n.posts[1].body).toEqual({ rel: 'ADDRESSES', dir: 'out', target: 'PAIN-BOL', action: 'add' });
    expect(onCreated).toHaveBeenCalledWith('PAIN-BOL');
  });
});
