// SPRINT_UXR_S5_RECORD_TASKS/S5-08 — слияние по блокам и построчный дифф спорных.
// Проверка из задачи: две параллельные правки разных блоков сливаются без потерь;
// правка одного блока показывает построчный дифф только по нему.
import { describe, expect, it } from 'vitest';
import { lineDiff, mergeBlocks, resolveMerge, splitBlocks } from './blockMerge';

const base = ['# Заголовок', 'Первый абзац.', 'Второй абзац\nв две строки.', '- пункт 1\n- пункт 2'].join('\n\n');

describe('splitBlocks', () => {
  it('режет по пустым строкам, склейка возвращает исходник', () => {
    expect(splitBlocks(base)).toHaveLength(4);
    expect(splitBlocks(base).join('\n\n')).toBe(base);
  });

  it('огороженный код и $$-блок с пустыми строками внутри — один блок', () => {
    const md = 'до\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n$$\nx\n\ny\n$$\n\nпосле';
    const blocks = splitBlocks(md);
    expect(blocks).toEqual(['до', '```ts\nconst a = 1;\n\nconst b = 2;\n```', '$$\nx\n\ny\n$$', 'после']);
  });

  it('пустой текст — ноль блоков', () => {
    expect(splitBlocks('')).toEqual([]);
    expect(splitBlocks('\n\n')).toEqual([]);
  });
});

describe('mergeBlocks', () => {
  it('правки РАЗНЫХ блоков сливаются без потерь и без спора', () => {
    const mine = base.replace('Первый абзац.', 'Первый абзац — моя правка.');
    const theirs = base.replace('- пункт 2', '- пункт 2\n- пункт 3 (их)');
    const r = mergeBlocks(base, mine, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toContain('Первый абзац — моя правка.');
    expect(r.text).toContain('- пункт 3 (их)');
    expect(r.text).toBe(mine.replace('- пункт 2', '- пункт 2\n- пункт 3 (их)'));
  });

  it('вставки в разных местах и удаление чужого блока — тоже без спора', () => {
    const mine = base.replace('# Заголовок', '# Заголовок\n\nМой новый абзац.');
    const theirs = base.replace('\n\nВторой абзац\nв две строки.', '');
    const r = mergeBlocks(base, mine, theirs);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(['# Заголовок', 'Мой новый абзац.', 'Первый абзац.', '- пункт 1\n- пункт 2'].join('\n\n'));
  });

  it('обе стороны сделали одно и то же — не спор', () => {
    const same = base.replace('Первый абзац.', 'Одинаково.');
    const r = mergeBlocks(base, same, same);
    expect(r.conflicts).toBe(0);
    expect(r.text).toBe(same);
  });

  it('правка ОДНОГО блока обеими — спор только по нему, остальное слито', () => {
    const mine = base.replace('Второй абзац\nв две строки.', 'Второй абзац\nмоя строка.').replace('Первый абзац.', 'Мой первый.');
    const theirs = base.replace('Второй абзац\nв две строки.', 'Второй абзац\nих строка.');
    const r = mergeBlocks(base, mine, theirs);
    expect(r.conflicts).toBe(1);
    expect(r.text).toBeNull();
    const disputed = r.chunks.filter(c => c.kind === 'conflict');
    expect(disputed).toHaveLength(1);
    const c = disputed[0];
    if (c.kind !== 'conflict') throw new Error('unreachable');
    expect(c.mine).toBe('Второй абзац\nмоя строка.');
    expect(c.theirs).toBe('Второй абзац\nих строка.');
    expect(c.base).toBe('Второй абзац\nв две строки.');
    // Неспорная правка (мой первый абзац) — в слитых кусках, не в споре.
    expect(r.chunks.some(k => k.kind === 'ok' && k.text.includes('Мой первый.'))).toBe(true);
    // Построчный дифф спорного блока: общая строка одна, по строке «их» и «моё».
    expect(lineDiff(c.theirs, c.mine)).toEqual([
      { op: 'same', line: 'Второй абзац' },
      { op: 'del', line: 'их строка.' },
      { op: 'add', line: 'моя строка.' },
    ]);
  });

  it('выбор по спорному блоку собирает текст; невыбранный спор — null', () => {
    const mine = base.replace('Первый абзац.', 'Моё.');
    const theirs = base.replace('Первый абзац.', 'Их.');
    const r = mergeBlocks(base, mine, theirs);
    expect(r.conflicts).toBe(1);
    expect(resolveMerge(r.chunks, {})).toBeNull();
    expect(resolveMerge(r.chunks, { 0: 'mine' })).toBe(mine);
    expect(resolveMerge(r.chunks, { 0: 'theirs' })).toBe(theirs);
  });

  it('пустая база (поле было пустым) и оба написали разное — один спор', () => {
    const r = mergeBlocks('', 'моё', 'их');
    expect(r.conflicts).toBe(1);
  });

  it('я ничего не менял — берётся их текст целиком', () => {
    const theirs = base.replace('Первый абзац.', 'Их.');
    expect(mergeBlocks(base, base, theirs).text).toBe(theirs);
  });
});

describe('lineDiff', () => {
  it('склейка same+del даёт «было», same+add — «стало»', () => {
    const a = 'a\nb\nc\nd';
    const b = 'a\nx\nc\nd\ne';
    const d = lineDiff(a, b);
    expect(d.filter(x => x.op !== 'add').map(x => x.line).join('\n')).toBe(a);
    expect(d.filter(x => x.op !== 'del').map(x => x.line).join('\n')).toBe(b);
  });
});
