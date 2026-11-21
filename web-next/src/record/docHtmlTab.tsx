// Вкладка «HTML» паспорта документа (SPRINT_LORE_MODEL_DOCS_TIDY/MDL-08, часть 2).
// Владелица 20.11.2026: «HTML выведи отдельной вкладкой в паспорт и посмотри рендеринг».
// У части доков тело — HTML-фрагмент (KnowDoc.content_html, пишет doc_new), а паспорт показывал только
// markdown-тела: HTML было не увидеть. Рисуется ТОЛЬКО в песочнице (SandboxedHtmlFrame — правило проекта:
// HTML вне песочницы не исполняется). Нет HTML — вкладки нет, конфиг не меняется.
import type { KitConfig, KindConfig } from '@seidr/kit';
import { SandboxedHtmlFrame } from '@seidr/kit/content';

export const DOC_HTML_TAB = 'html';

type Tab = NonNullable<KindConfig['tabs']>[number];

/** Конфиг паспорта с вкладкой «HTML» у вида записи; прочие вкладки вида — следом. */
export function withDocHtmlTab(config: KitConfig, kind: string, title: string, html: unknown): KitConfig {
  const k = config.kinds[kind];
  if (!k || typeof html !== 'string' || !html.trim()) return config;
  const tab: Tab = { key: DOC_HTML_TAB, title, render: r => <SandboxedHtmlFrame html={html} title={r.title} minHeight={240} /> };
  const rest = (k.tabs ?? []).filter(x => x.key !== DOC_HTML_TAB);
  return { ...config, kinds: { ...config.kinds, [kind]: { ...k, tabs: [tab, ...rest] } } };
}
