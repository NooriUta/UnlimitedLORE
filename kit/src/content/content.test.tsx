// @vitest-environment jsdom
// SPRINT_UXR_S4_UI_SHELL_LISTS/S4-00d — переиспользуемые MD/HTML-элементы в
// Seiðr-kit: TipTapField (правка MD), MartProse (чтение MD + mermaid/bpmn),
// SandboxedHtmlFrame (HTML только в песочнице) и общий санитайзер. Скопированы
// из замороженного v1 (src/, D-2026-UXR-V2-FOLDER-V1-FROZEN) без правки src/;
// здесь — их контракт уже как элементов kit: подписи из локалей kit, стиль из
// seidr.css, никакой зависимости от API v1.
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axeViolations } from '../test/axe';

// mermaid в jsdom не рисует (нет раскладки SVG): подменяем рендер, чтобы
// проверять наш контракт — что фенс ушёл в диаграмму, а не остался текстом.
vi.mock('mermaid', () => ({
  default: {
    registerLayoutLoaders: vi.fn(),
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"><text>diagram</text></svg>` })),
  },
}));
vi.mock('bpmn-js/lib/NavigatedViewer', () => ({
  default: class {
    importXML() { return Promise.resolve(); }
    get() { return { zoom: () => {} }; }
    destroy() {}
  },
}));

import { KitLangProvider } from '../index';
import {
  MartProse, SandboxedHtmlFrame, TipTapField,
  sanitizeMd, sanitizeSvg, toSegments, frameThemeCss, readFrameTheme, hostFrameTheme, FRAME_THEME_FALLBACK,
} from './index';
import { wrapSandboxHtml } from './SandboxedHtmlFrame';

describe('sanitizeMd / sanitizeSvg — общий санитайзер kit', () => {
  it('режет <script>, on*-обработчики и javascript:-ссылки, разметку markdown оставляет', () => {
    const out = sanitizeMd('<h2>T</h2><img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">l</a><table><tr><td>1</td></tr></table>');
    expect(out).toContain('<h2>T</h2>');
    expect(out).toContain('<table>');
    expect(out).not.toMatch(/onerror|<script|javascript:/);
  });

  it('пустое остаётся пустым; SVG сохраняет фигуры без скриптов', () => {
    expect(sanitizeMd('')).toBe('');
    const svg = sanitizeSvg('<svg><text>a</text><script>x()</script></svg>');
    expect(svg).toContain('<text>a</text>');
    expect(svg).not.toContain('script');
  });
});

describe('MartProse — чтение MD', () => {
  it('toSegments выносит mermaid и bpmn из HTML-потока по порядку', () => {
    const segs = toSegments('# A\n\n```mermaid\ngraph TD; a-->b\n```\n\ntext\n\n```bpmn\n<x/>\n```\n');
    expect(segs.map(s => s.kind)).toEqual(['html', 'mermaid', 'html', 'bpmn']);
  });

  it('рендерит GFM-таблицу в классе sk-prose и санитизирует HTML', () => {
    const { container } = render(<MartProse text={'| a | b |\n|---|---|\n| 1 | 2 |\n\n<img src=x onerror="alert(1)">'} />);
    const root = container.querySelector('.sk-prose')!;
    expect(root).toBeTruthy();
    expect(root.querySelector('table')).toBeTruthy();
    expect(root.innerHTML).not.toContain('onerror');
  });

  it('mermaid-фенс становится диаграммой, а не сырым текстом', async () => {
    const { container } = render(<MartProse text={'```mermaid\ngraph TD; a-->b\n```'} />);
    await waitFor(() => expect(container.querySelector('.sk-prose__mermaid svg')).toBeTruthy());
    expect(container.textContent).not.toContain('```mermaid');
  });

  it('чек-лист GFM: у флажка есть имя (axe «label»), по-русски и по-английски', async () => {
    const md = '- [x] сделано\n- [ ] не сделано';
    const ru = render(<MartProse text={md} />);
    const boxes = ru.container.querySelectorAll('input[type="checkbox"]');
    expect(Array.from(boxes).map(b => b.getAttribute('aria-label'))).toEqual(['выполнено', 'не выполнено']);
    expect(await axeViolations(ru.container)).toEqual([]);
    ru.unmount();
    const en = render(<KitLangProvider lang="en"><MartProse text={md} /></KitLangProvider>);
    expect(en.container.querySelector('input[type="checkbox"]')!.getAttribute('aria-label')).toBe('done');
  });

  it('пустой текст — ничего не рисует (пустое поле решает вызывающий)', () => {
    const { container } = render(<MartProse text="" />);
    expect(container.innerHTML).toBe('');
  });
});

describe('SandboxedHtmlFrame — HTML только в песочнице', () => {
  it('iframe sandbox="allow-scripts" без allow-same-origin, CSP default-src none', () => {
    const { container } = render(<SandboxedHtmlFrame html="<p>hi</p>" title="Док" />);
    const fr = container.querySelector('iframe')!;
    expect(fr.getAttribute('sandbox')).toBe('allow-scripts');
    expect(fr.getAttribute('title')).toBe('Док');
    const doc = fr.getAttribute('srcdoc')!;
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<p>hi</p>');
  });

  it('без title — подпись по умолчанию из локали kit (ru/en)', () => {
    const { container, unmount } = render(<SandboxedHtmlFrame html="x" />);
    expect(container.querySelector('iframe')!.getAttribute('title')).toBe('HTML-фрагмент');
    unmount();
    const en = render(<KitLangProvider lang="en"><SandboxedHtmlFrame html="x" /></KitLangProvider>);
    expect(en.container.querySelector('iframe')!.getAttribute('title')).toBe('HTML fragment');
  });

  it('тема рамки — из токенов хоста, без прибитых цветов', () => {
    const th = readFrameTheme(n => (n === '--t1' ? 'red' : ''));
    expect(th.text).toBe('red');
    expect(th.link).toBe(FRAME_THEME_FALLBACK.link);
    expect(frameThemeCss(th)).toContain('color:red');
  });

  // K4-SANDBOX-DARK-CONTRAST (приёмка 14.11, тёмная тема): белая рамка и бледный
  // текст. Текст песочница брала из токенов тёмной темы (светлый --t1), а схему
  // цвета — нет: документ srcdoc без color-scheme считается светлым, хост — тёмный,
  // и при несовпадении схем браузер обязан подложить под iframe непрозрачный
  // светлый Canvas (CSS Color Adjust §2.2). Светлое на белом. Схема хоста едет
  // в песочницу вместе с цветами — пара «фон + текст» из одной темы.
  it('схема цвета хоста едет в песочницу вместе с цветами (тёмная тема — тёмная схема)', () => {
    const dark = readFrameTheme(n => ({ '--t1': '#e8dcc0', 'color-scheme': 'dark' } as Record<string, string>)[n] ?? '');
    expect(dark.scheme).toBe('dark');
    expect(frameThemeCss(dark)).toMatch(/:root\{color-scheme:dark;?\}/);
    const light = readFrameTheme(n => (n === 'color-scheme' ? 'light' : ''));
    expect(frameThemeCss(light)).toMatch(/:root\{color-scheme:light;?\}/);
    expect(wrapSandboxHtml('<p>x</p>', 't', dark)).toContain('color-scheme:dark');
  });

  // MDL-08 ч.2 (20.11.2026, проверка рендера вкладки «HTML» паспорта документа): рамка, загруженная во вкладке,
  // которую показали позже (скрытой её высота = своей), сообщала высоту 240 и больше не обновляла — тело
  // документа обрезалось. Сигнал _skResize обязан следовать за раскладкой (ResizeObserver), а не только за
  // загрузкой и правкой DOM.
  it('высота рамки следует за раскладкой тела: ResizeObserver в обвязке песочницы', () => {
    const html = wrapSandboxHtml('<p>x</p>', 't', readFrameTheme(() => ''));
    expect(html).toMatch(/new ResizeObserver\(post\)\.observe\(document\.body\)/);
    expect(html).toContain('_skResize');
  });

  // Витрина /kit переключает тему на обёртке ([data-mode] поддерева), а не на <html>:
  // песочница читала корень и в «Светлой» получала светлый текст тёмной темы.
  // jsdom наследование CSS-переменных не считает, поэтому проверяются две части:
  // hostFrameTheme читает ТОТ узел, что ему дали, а рамка даёт ему себя.
  it('тема берётся в месте рамки: hostFrameTheme(узел) читает узел, рамка передаёт себя', () => {
    const el = document.createElement('div');
    el.style.setProperty('--t1', 'rgb(1, 2, 3)');
    document.body.appendChild(el);
    expect(hostFrameTheme(el).text).toBe('rgb(1, 2, 3)');
    expect(hostFrameTheme().text).not.toBe('rgb(1, 2, 3)');
    el.remove();

    const spy = vi.spyOn(window, 'getComputedStyle');
    try {
      const { container } = render(<div data-mode="light"><SandboxedHtmlFrame html="<p>x</p>" /></div>);
      const frame = container.querySelector('iframe')!;
      expect(spy.mock.calls.some(c => c[0] === frame), 'тема прочитана у самого iframe').toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it('схема хоста не задана — запасная пара системных цветов (CanvasText на Canvas одной схемы)', () => {
    const th = readFrameTheme(() => '');
    expect(th.scheme).toBe(FRAME_THEME_FALLBACK.scheme);
    expect(th.text).toBe('CanvasText');
    expect(frameThemeCss(th)).toMatch(/color-scheme:normal/);
  });
});

describe('TipTapField — правка MD', () => {
  it('панель инструментов подписана из локали kit, поле — именованный textbox; axe чист', async () => {
    const { container } = render(<TipTapField value="**жир**" onChange={() => {}} ariaLabel="Описание" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /жирный/i })).toBeTruthy());
    expect(screen.getByRole('textbox', { name: 'Описание' })).toBeTruthy();
    expect(container.querySelector('.sk-md')).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it('английская локаль меняет подписи кнопок', async () => {
    render(<KitLangProvider lang="en"><TipTapField value="" onChange={() => {}} ariaLabel="Body" /></KitLangProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: /bold/i })).toBeTruthy());
  });

  it('картинки — только если вызывающий дал загрузчик (kit не знает API v1)', async () => {
    const { unmount } = render(<TipTapField value="" onChange={() => {}} ariaLabel="A" />);
    await waitFor(() => screen.getByRole('button', { name: /жирный/i }));
    expect(screen.queryByRole('button', { name: /изображение/i })).toBeNull();
    unmount();
    render(<TipTapField value="" onChange={() => {}} ariaLabel="B" onUploadImage={async () => ({ url: 'u' })} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /изображение/i })).toBeTruthy());
  });

  it('editable=false — просмотр без панели инструментов', async () => {
    const { container } = render(<TipTapField value="текст" onChange={() => {}} editable={false} ariaLabel="R" />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeTruthy());
    expect(container.querySelector('.sk-md__toolbar')).toBeNull();
  });
});
