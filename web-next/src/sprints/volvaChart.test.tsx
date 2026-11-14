// @vitest-environment jsdom
// SPRINT_VIZ_EMBED/EMB-L2 · VE-4 — встройка Völva в v2 (перенос из v1).
//
// Причина дефекта приёмки 14.11.2026 (препрод ef099926): рамка и слой
// charts.layer были написаны только во фронте v1 (src/components/lore), а v1
// заморожен с 07.11 (S3-10). В v2 настройку charts.layer можно было выставить
// во «Флагах», но её не читал НИ ОДИН экран — встройки не было нигде, даже
// честного «не настроено».
//
// Место — D-2026-LORE-VIZ-EMBED-PLACES: «Спринты», график sprints_timeline
// (карточка 44), ДОПОЛНИТЕЛЬНЫМ видом рядом с таймлайном, а не вместо него.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import gameIcons from '@iconify-json/game-icons/icons.json';
import { registerGameIcons } from '@seidr/kit';
import { ListScreen } from '../pages/ListScreen';
import { chartLayerOf, volvaEmbedState, VOLVA_SPRINTS_CHART } from './volvaChart';

beforeAll(() => { registerGameIcons(gameIcons); });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const setting = (code: string, value: string, is_active = true) =>
  ({ dict_type: 'app_setting', code, label_ru: value, is_active });

describe('charts.layer: встройка только явным volva', () => {
  it('нет записи, пусто, echarts, выключено, мусор — echarts', () => {
    expect(chartLayerOf([])).toBe('echarts');
    expect(chartLayerOf([setting('charts.layer', '')] as never)).toBe('echarts');
    expect(chartLayerOf([setting('charts.layer', 'echarts')] as never)).toBe('echarts');
    expect(chartLayerOf([setting('charts.layer', 'volva', false)] as never)).toBe('echarts');
    expect(chartLayerOf([setting('charts.layer', 'grafana')] as never)).toBe('echarts');
  });
  it('volva и Völva (с умлаутом, любым регистром) — volva', () => {
    expect(chartLayerOf([setting('charts.layer', 'volva')] as never)).toBe('volva');
    expect(chartLayerOf([setting('charts.layer', ' Völva ')] as never)).toBe('volva');
  });
});

describe('подпись встройки: ответ бэкенда → честное состояние', () => {
  const run = (res: Response | Error) => {
    const urls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      if (res instanceof Error) throw res;
      return res;
    }) as unknown as typeof fetch;
    return { urls, go: (projects: string[]) => volvaEmbedState('sprints_timeline', projects, impl) };
  };

  it('200 — ready с адресом; проекты скоупа — через запятую в project', async () => {
    const r = run(json({ url: 'https://volva.example.org/embed/question/J', expires_at: 'x' }));
    const s = await r.go(['AIDA/miniLORE', 'NooriUta/UnlimitedLORE']);
    expect(s).toEqual({ kind: 'ready', signedUrl: 'https://volva.example.org/embed/question/J' });
    const u = new URL(r.urls[0], 'http://lore.test');
    expect(u.pathname).toBe('/lore/embed/volva/sprints_timeline');
    expect(u.searchParams.get('project')).toBe('AIDA/miniLORE,NooriUta/UnlimitedLORE');
  });

  it('503 NOT_CONFIGURED — «не настроено» с тем, что настроить', async () => {
    const s = await run(json({ error: 'NOT_CONFIGURED', detail: 'нет ключа' }, 503)).go(['A/B']);
    expect(s.kind).toBe('not_configured');
    expect(String((s as { hint: string }).hint)).toMatch(/LORE_VOLVA_EMBED_SECRET/);
    expect(String((s as { hint: string }).hint)).toMatch(/LORE_VOLVA_EMBED_SITE_URL/);
  });

  it('404 UNKNOWN_CHART — тоже «не настроено»: графика нет в белом списке', async () => {
    const s = await run(json({ error: 'UNKNOWN_CHART', detail: 'нет' }, 404)).go(['A/B']);
    expect(s.kind).toBe('not_configured');
    expect(String((s as { hint: string }).hint)).toMatch(/lore\.volva\.embed\.charts/);
  });

  it('403 — нет прав, причина с сервера', async () => {
    const s = await run(json({ error: 'FORBIDDEN_PROJECT', detail: 'проект X вне ваших проектов' }, 403)).go(['X/Y']);
    expect(s).toEqual({ kind: 'forbidden', reason: 'проект X вне ваших проектов' });
  });

  it('400 PROJECT_REQUIRED — «выберите проект», а не ошибка', async () => {
    const s = await run(json({ error: 'PROJECT_REQUIRED', detail: 'нужен проект' }, 400)).go([]);
    expect(s.kind).toBe('needs');
  });

  it('502, сеть, страница вместо JSON — «недоступна» с причиной', async () => {
    expect((await run(json({ error: 'BAD_GATEWAY' }, 502)).go(['A/B'])).kind).toBe('unavailable');
    expect((await run(new TypeError('Failed to fetch')).go(['A/B'])).kind).toBe('unavailable');
    const html = new Response('<html/>', { status: 200, headers: { 'content-type': 'text/html' } });
    expect((await run(html).go(['A/B'])).kind).toBe('unavailable');
  });
});

describe('«Спринты» v2: вид Völva рядом с таймлайном', () => {
  const ROW = { sprint_id: 'SP', name: 'Спринт SP', status_raw: '🔄 IN PROGRESS' };
  const net = (layer: string | null, embed: Response) => {
    const urls: string[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      urls.push(u);
      if (u.includes('/slice/dictionary') && u.includes('app_setting')) {
        return json({ rows: layer === null ? [] : [setting('charts.layer', layer)] });
      }
      if (u.includes('/embed/volva/')) return embed.clone();
      return json({ rows: [ROW] });
    }) as unknown as typeof fetch;
    return { impl, urls };
  };

  it('charts.layer=echarts — вида Völva нет, таймлайн на месте, подпись не запрашивается', async () => {
    window.history.replaceState(null, '', '/');
    const { impl, urls } = net('echarts', json({}));
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await screen.findByText('Спринт SP', {}, { timeout: 8000 });
    await waitFor(() => expect(urls.some(u => u.includes('app_setting'))).toBe(true));
    expect(screen.getByRole('radio', { name: /Таймлайн/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Völva/ })).toBeNull();
    expect(urls.some(u => u.includes('/embed/volva/'))).toBe(false);
  }, 15000);

  // Владелица 14.11.2026 (прод: charts.layer=volva без ключа): «фолбек на echarts
  // должна быть у тех у кого нет настройки интеграции с volva». Не настроено —
  // вида Völva нет, раздел остаётся на своих видах, как при echarts.
  it('charts.layer=volva, ключа нет (503) — фолбэк: вида Völva нет, таймлайн на месте', async () => {
    window.history.replaceState(null, '', '/?proj=NooriUta%2FUnlimitedLORE');
    const { impl, urls } = net('volva', json({ error: 'NOT_CONFIGURED', detail: 'нет ключа' }, 503));
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await screen.findByText('Спринт SP', {}, { timeout: 8000 });
    await waitFor(() => expect(urls.some(u => u.includes('/embed/volva/'))).toBe(true));
    await new Promise(r => setTimeout(r, 50));
    expect(screen.getByRole('radio', { name: /Таймлайн/ })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: /Völva/ })).toBeNull();
    window.history.replaceState(null, '', '/');
  }, 15000);

  it('charts.layer=volva, графика нет в белом списке (404) — тоже фолбэк', async () => {
    window.history.replaceState(null, '', '/?proj=NooriUta%2FUnlimitedLORE');
    const { impl, urls } = net('volva', json({ error: 'UNKNOWN_CHART', detail: 'нет' }, 404));
    render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await screen.findByText('Спринт SP', {}, { timeout: 8000 });
    await waitFor(() => expect(urls.some(u => u.includes('/embed/volva/'))).toBe(true));
    await new Promise(r => setTimeout(r, 50));
    expect(screen.queryByRole('radio', { name: /Völva/ })).toBeNull();
    window.history.replaceState(null, '', '/');
  }, 15000);

  it('charts.layer=volva, Völva настроена — вид есть, рамка с адресом подписи', async () => {
    window.history.replaceState(null, '', '/?proj=NooriUta%2FUnlimitedLORE');
    const { impl, urls } = net('volva', json({ url: 'https://volva.example.org/embed/question/J', expires_at: 'x' }));
    const { container } = render(<ListScreen screen="sprints" fetchImpl={impl} urlState={false} />);
    await screen.findByText('Спринт SP', {}, { timeout: 8000 });
    const radio = await screen.findByRole('radio', { name: /Völva/ }, { timeout: 8000 });
    expect(screen.getByRole('radio', { name: /Таймлайн/ })).toBeTruthy();
    fireEvent.click(radio);
    await waitFor(() => expect(container.querySelector('iframe')).not.toBeNull());
    // Первый запрос — проверка «настроена ли» (без проекта), последний — подпись рамки.
    const req = urls.filter(u => u.includes('/embed/volva/')).pop()!;
    expect(req).toContain(`/embed/volva/${VOLVA_SPRINTS_CHART}`);
    expect(decodeURIComponent(req)).toContain('project=NooriUta/UnlimitedLORE');
    window.history.replaceState(null, '', '/');
  }, 15000);
});
