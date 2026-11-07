// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-10: хуки рендера по виду записи —
// kinds.X.overview(record, ctx) и kinds.X.tabs[{key,title,render}].
// ctx = данные (X_DATA), href, esc, md. Исключение в хуке ломает только свой
// блок (errBlock), соседние блоки и вкладки продолжают работать.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KitConfig, KitData, KitRecord } from './contract';
import { KindBlock, KindOverview, KindTabsView, createKitCtx, escHtml, resolveKindTabs } from './kindHooks';

const rec: KitRecord = { id: 'Q-1', kind: 'Quiz', title: 'Квиз о рунах', status: 'ok', fields: { question: 'Что значит ᚠ?' }, body_md: '**тело**' };
const plain: KitRecord = { id: 'T-1', kind: 'Topic', title: 'Тема', status: '', fields: {}, body_md: 'просто *текст*' };
const data: KitData = { records: [rec, plain], edges: [], journal: [], meta: { generated_at: '2026-11-07T00:00:00Z' } };

function cfg(kinds: KitConfig['kinds']): KitConfig {
  return { modules: [], menu: { groups: [] }, kinds, statuses: { items: [] } };
}

const mdStub = (s: string) => <div data-testid="md">{s}</div>;

describe('escHtml', () => {
  it('экранирует пять HTML-символов', () => {
    expect(escHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
  it('не-строку приводит к строке, null/undefined — пусто', () => {
    expect(escHtml(5 as unknown as string)).toBe('5');
    expect(escHtml(null as unknown as string)).toBe('');
  });
});

describe('createKitCtx', () => {
  it('ctx несёт данные, конфиг, роль и пользователя', () => {
    const config = cfg({});
    const ctx = createKitCtx({ data, config, role: 'editor', user: 'anna', md: mdStub });
    expect(ctx.data).toBe(data);
    expect(ctx.config).toBe(config);
    expect(ctx.role).toBe('editor');
    expect(ctx.user).toBe('anna');
    expect(ctx.esc('<b>')).toBe('&lt;b&gt;');
  });
  it('href по умолчанию — состояние в hash (работает и на file://)', () => {
    const ctx = createKitCtx({ data, config: cfg({}), md: mdStub });
    expect(ctx.href('Q 1/ä')).toBe('#record=Q%201%2F%C3%A4');
  });
  it('свой href и md приложения перекрывают умолчания', () => {
    const ctx = createKitCtx({ data, config: cfg({}), href: id => `/r/${id}`, md: mdStub });
    expect(ctx.href('Q-1')).toBe('/r/Q-1');
    render(<>{ctx.md('x')}</>);
    expect(screen.getByTestId('md').textContent).toBe('x');
  });
});

describe('KindOverview', () => {
  it('рисует React-узел хука и передаёт в него запись и ctx', () => {
    const overview = vi.fn((r: KitRecord, c) => <p>{r.title} · {c.data.records.length} · {c.href(r.id)}</p>);
    const ctx = createKitCtx({ data, config: cfg({ Quiz: { title: 'Квизы', icon: 'rune-stone', overview } }), md: mdStub });
    render(<KindOverview record={rec} ctx={ctx} />);
    expect(screen.getByText('Квиз о рунах · 2 · #record=Q-1')).toBeTruthy();
    expect(overview).toHaveBeenCalledWith(rec, ctx);
  });

  it('строку хука вставляет как HTML через санитайзер (esc + разметка конфига)', () => {
    const ctx = createKitCtx({
      data,
      config: cfg({ Quiz: { title: 'Квизы', icon: 'x', overview: (r, c) => `<b class="q">${c.esc(String(r.fields.question))}</b><script>window.__pwn=1</script><img src=x onerror="window.__pwn=1">` } }),
      md: mdStub,
    });
    const { container } = render(<KindOverview record={rec} ctx={ctx} />);
    expect(container.querySelector('b.q')?.textContent).toBe('Что значит ᚠ?');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')?.getAttribute('onerror')).toBeNull();
  });

  it('вид без overview — тело записи через ctx.md', () => {
    const ctx = createKitCtx({ data, config: cfg({ Topic: { title: 'Темы', icon: 'x' } }), md: mdStub });
    render(<KindOverview record={plain} ctx={ctx} />);
    expect(screen.getByTestId('md').textContent).toBe('просто *текст*');
  });

  it('вид, которого нет в конфиге, — тоже тело через ctx.md, не падение', () => {
    const ctx = createKitCtx({ data, config: cfg({}), md: mdStub });
    render(<KindOverview record={{ ...plain, kind: 'Nope' }} ctx={ctx} />);
    expect(screen.getByTestId('md')).toBeTruthy();
  });

  it('исключение в overview → errBlock только этого блока, с причиной', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = createKitCtx({
      data,
      config: cfg({ Quiz: { title: 'Квизы', icon: 'x', overview: () => { throw new Error('нет поля options'); } } }),
      md: mdStub,
    });
    render(
      <div>
        <KindOverview record={rec} ctx={ctx} />
        <p>сосед жив</p>
      </div>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('нет поля options');
    expect(alert.textContent).toContain('overview');
    expect(screen.getByText('сосед жив')).toBeTruthy();
  });
});

describe('resolveKindTabs / KindTabsView', () => {
  const boom = () => { throw new Error('вкладка упала'); };
  const kinds: KitConfig['kinds'] = {
    Quiz: {
      title: 'Квизы',
      icon: 'x',
      tabs: [
        { key: 'play', title: 'Играть', render: r => <p>играем {r.id}</p> },
        { key: 'bad', title: 'Сломанная', render: boom },
        { key: 'html', title: 'HTML', render: (_r, c) => `<i>${c.esc('<ok>')}</i>` },
      ],
    },
  };

  it('отдаёт ключи и заголовки вкладок вида; вид без tabs — пусто', () => {
    const ctx = createKitCtx({ data, config: cfg(kinds), md: mdStub });
    expect(resolveKindTabs(rec, ctx).map(t => [t.key, t.title])).toEqual([['play', 'Играть'], ['bad', 'Сломанная'], ['html', 'HTML']]);
    expect(resolveKindTabs(plain, ctx)).toEqual([]);
  });

  it('рисует выбранную вкладку и переключает по клику (управляемо)', () => {
    const ctx = createKitCtx({ data, config: cfg(kinds), md: mdStub });
    const onChange = vi.fn();
    const { rerender } = render(<KindTabsView record={rec} ctx={ctx} value="play" onChange={onChange} label="Вкладки" />);
    expect(screen.getByRole('tabpanel').textContent).toContain('играем Q-1');
    fireEvent.click(screen.getByRole('tab', { name: 'HTML' }));
    expect(onChange).toHaveBeenCalledWith('html');
    rerender(<KindTabsView record={rec} ctx={ctx} value="html" onChange={onChange} label="Вкладки" />);
    expect(screen.getByRole('tabpanel').querySelector('i')?.textContent).toBe('<ok>');
  });

  it('значение вне списка — первая вкладка', () => {
    const ctx = createKitCtx({ data, config: cfg(kinds), md: mdStub });
    render(<KindTabsView record={rec} ctx={ctx} value="nope" onChange={() => {}} label="Вкладки" />);
    expect(screen.getByRole('tabpanel').textContent).toContain('играем');
  });

  it('упавшая вкладка → errBlock в своей панели, вкладки и соседний блок живы', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = createKitCtx({ data, config: cfg(kinds), md: mdStub });
    render(
      <div>
        <KindTabsView record={rec} ctx={ctx} value="bad" onChange={() => {}} label="Вкладки" />
        <KindBlock id="side" record={rec} ctx={ctx} render={r => <span>бок {r.id}</span>} />
      </div>,
    );
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByRole('alert').textContent).toContain('вкладка упала');
    expect(within(panel).getByRole('alert').textContent).toContain('bad');
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByText('бок Q-1')).toBeTruthy();
  });

  it('вид без вкладок — ничего не рисует', () => {
    const ctx = createKitCtx({ data, config: cfg(kinds), md: mdStub });
    const { container } = render(<KindTabsView record={plain} ctx={ctx} value="" onChange={() => {}} label="Вкладки" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('KindBlock', () => {
  it('«Повторить» перезапускает хук: исправился — блок рисуется', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let fail = true;
    const ctx = createKitCtx({ data, config: cfg({}), md: mdStub });
    render(<KindBlock id="flaky" record={rec} ctx={ctx} render={() => { if (fail) throw new Error('раз'); return <b>два</b>; }} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('два')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('null/undefined из хука — пусто, без плашки', () => {
    const ctx = createKitCtx({ data, config: cfg({}), md: mdStub });
    const { container } = render(<KindBlock id="n" record={rec} ctx={ctx} render={() => null} />);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
