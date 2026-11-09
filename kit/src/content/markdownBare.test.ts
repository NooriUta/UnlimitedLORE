// @vitest-environment jsdom
// SPRINT_UXR_S10_SEIDR_KIT/K-13 — чтение Markdown в kit без сборки.
//
// Задача: страница на голом HTML (как kit/demo/seidr-bare.html) должна уметь
// показать тело записи, не поднимая React и сборщик. Чтение — marked +
// DOMPurify, диаграммы — mermaid, если он есть.
//
// Главное требование владелицы: фолбэк «исходник + ошибка». Если что-то
// пошло не так, человек видит ИСХОДНЫЙ текст и причину, а не пустое место:
// пустое место неотличимо от «в записи ничего не написано».
import { describe, expect, it } from 'vitest';
import { renderMarkdownBare } from './markdownBare';

describe('K-13 · чтение Markdown без сборки', () => {
  it('обычный markdown превращается в html', () => {
    const r = renderMarkdownBare('# Заголовок\n\nтекст и **жирное**');
    expect(r.ok).toBe(true);
    expect(r.html).toContain('<h1');
    expect(r.html).toContain('<strong>');
  });

  it('таблицы GFM поддержаны — ими написана половина наших записей', () => {
    const r = renderMarkdownBare('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(r.html).toContain('<table');
  });

  it('опасный html вычищается, а текст остаётся', () => {
    const r = renderMarkdownBare('привет <img src=x onerror="alert(1)"> и <script>alert(2)</script> конец');
    expect(r.html).not.toContain('onerror');
    expect(r.html).not.toContain('<script');
    expect(r.html).toContain('привет');
    expect(r.html).toContain('конец');
  });

  it('пустое тело — честно пусто, без выдуманной обёртки', () => {
    const r = renderMarkdownBare('');
    expect(r.ok).toBe(true);
    expect(r.html).toBe('');
  });

  it('блок mermaid не исполняется разметкой: остаётся узнаваемой обёрткой', () => {
    const r = renderMarkdownBare('```mermaid\nflowchart TB\n A --> B\n```');
    expect(r.html).toContain('sk-prose__mermaid');
    // Исходник схемы сохранён: его рисует mermaid потом, а если не сможет —
    // человек хотя бы увидит текст.
    expect(r.html).toContain('flowchart TB');
    expect(r.diagrams).toBe(1);
  });

  it('сбой разбора — исходник и причина, а не пустота', () => {
    const r = renderMarkdownBare('что угодно', {
      parse: () => { throw new Error('marked сломался'); },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/marked сломался/);
    // Исходный текст виден целиком.
    expect(r.html).toContain('что угодно');
    expect(r.html).toContain('sk-prose__fallback');
  });

  it('сбой очистки тоже даёт исходник, а не непроверенный html', () => {
    const r = renderMarkdownBare('# текст', {
      sanitize: () => { throw new Error('DOMPurify недоступен'); },
    });
    expect(r.ok).toBe(false);
    expect(r.html).toContain('# текст');
    // Неочищенную разметку не показываем ни при каких обстоятельствах.
    expect(r.html).not.toContain('<h1');
  });

  it('исходник в фолбэке экранирован: он текст, а не разметка', () => {
    const r = renderMarkdownBare('<b>жирное</b>', { parse: () => { throw new Error('x'); } });
    expect(r.html).toContain('&lt;b&gt;');
    expect(r.html).not.toContain('<b>жирное</b>');
  });
});
