// Вкладка «HTML» паспорта документа (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08, часть 2). Владелица 20.11.2026:
// «HTML выведи отдельной вкладкой в паспорт и посмотри рендеринг». Подставная сеть: /lore/record отдаёт док с
// HTML-телом (content_html), паспорт во весь экран → вкладка «HTML» → iframe-песочница с содержимым.
// Настоящие тела доков (снимок прода) — файлом из DOC_HTML_FIXTURE ([{doc_id, title, kind, content_html,
// content_md_ru}]); без него — свой образец. Снимки — e2e/.results/doc-html-<doc>-<проекция>.png.
import fs from 'node:fs';
import { expect, test } from '@playwright/test';

type Doc = { doc_id: string; title: string; kind: string; content_html: string; content_md_ru?: string | null };
const SAMPLE: Doc[] = [{ doc_id: 'DOC-HTML-1', title: 'Обзор платформы', kind: 'guide',
  content_html: '<h1>Обзор</h1><p>Текст <b>HTML</b>-тела.</p><table><tr><th>Слой</th><th>Роль</th></tr><tr><td>A</td><td>B</td></tr></table><pre><code>SELECT 1;</code></pre>',
  content_md_ru: '# Обзор\n\nMarkdown-тело.' }];
const DOCS: Doc[] = process.env.DOC_HTML_FIXTURE ? JSON.parse(fs.readFileSync(process.env.DOC_HTML_FIXTURE, 'utf8')) : SAMPLE;

const contract = (d: Doc) => ({
  contract: 'lore.record/1',
  record: { type: 'doc', id: d.doc_id, title: d.title, status: '', version: null },
  values: { title: d.title, kind: d.kind, content_md_ru: d.content_md_ru ?? null, content_html: d.content_html },
  parts: [], links: [],
  perms: { can_edit: false, can_status: false, can_create: false, status_next: [], reason: null },
  facts: {},
  schema: {
    type: 'doc', label: 'Документ', label_key: 'rec.doc', icon: 'scroll-unfurled',
    fields: [
      { key: 'title', label: 'Название', label_key: 'pp.field.title', kind: 'text', group: 'head', required: true, editable: false },
      { key: 'kind', label: 'Вид', label_key: 'pp.field.docKind', kind: 'text', group: 'props', required: false, editable: false },
      { key: 'content_md_ru', label: 'Текст', label_key: 'pp.field.body', kind: 'md', group: 'body', required: false, editable: false },
    ],
    layout: {}, relations: [],
  },
  meta: { facade: 'server' },
});

for (const d of DOCS) {
  test(`док ${d.doc_id}: вкладка «HTML» — песочница с телом`, async ({ page }, info) => {
    test.skip(!['desktop-1280', 'doc-html-390'].includes(info.project.name), 'ноутбук 1280 и телефон 390');
    test.setTimeout(120_000); // холодный vite: первая загрузка собирает зависимости
    await page.route('**/lore/**', async route => {
      const u = new URL(route.request().url());
      const body = u.pathname.startsWith('/lore/record/') ? contract(d) : u.pathname.endsWith('/drafts') ? { drafts: [] } : { rows: [] };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto(`/?sec=doc&open=${encodeURIComponent(d.doc_id)}&place=full`, { waitUntil: 'domcontentloaded' });
    const tab = page.getByRole('tab', { name: 'HTML' });
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await tab.click();
    const frame = page.locator('iframe').first();
    await expect(frame).toBeVisible();
    expect(await frame.getAttribute('sandbox'), 'песочница без allow-same-origin').not.toContain('allow-same-origin');
    const entity = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const raw = d.content_html.match(/<h1[^>]*>([^<]+)</)?.[1];
    const firstHeading = raw ? entity(raw) : null;
    if (firstHeading) await expect(page.frameLocator('iframe').first().locator('h1').first()).toHaveText(firstHeading.trim());
    // нет горизонтальной прокрутки страницы
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'горизонтальная прокрутка страницы').toBeLessThanOrEqual(0);
    // тело видно целиком: высота рамки дотягивается до высоты документа внутри (сигнал _skResize)
    const inner = await page.frames()[1].evaluate(() => document.documentElement.scrollHeight);
    await expect.poll(async () => (await frame.boundingBox())?.height ?? 0, { message: `рамка ниже тела (${inner}px)` }).toBeGreaterThanOrEqual(inner);
    await page.screenshot({ path: `e2e/.results/doc-html-${d.doc_id}-${info.project.name}.png`, fullPage: true });
  });
}
