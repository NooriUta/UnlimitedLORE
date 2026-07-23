import { describe, it, expect } from 'vitest';
import { imageFilesFrom } from './TipTapField';

// Минимальная подделка DataTransfer: настоящий в jsdom не конструируется, а
// проверяем мы ОТБОР файлов, а не браузерный класс.
function dt(opts: {
  items?: { kind: string; type: string; file?: File | null }[];
  files?: File[];
}): DataTransfer {
  return {
    items: (opts.items ?? []).map(i => ({
      kind: i.kind, type: i.type, getAsFile: () => i.file ?? null,
    })),
    files: opts.files ?? [],
  } as unknown as DataTransfer;
}

const png = (name = 'a.png', size = 10) =>
  ({ name, size, type: 'image/png' }) as File;

describe('PL-24 · отбор картинок из drop/paste', () => {
  it('берёт картинку из items — так приходит вставка скриншота', () => {
    // Главный случай вставки из буфера: `files` пуст, картинка живёт в items.
    // Обход по одному лишь `files` не поймал бы её вовсе.
    const res = imageFilesFrom(dt({ items: [{ kind: 'file', type: 'image/png', file: png() }] }));
    expect(res).toHaveLength(1);
  });

  it('берёт картинку из files — так приходит перетаскивание из проводника', () => {
    expect(imageFilesFrom(dt({ files: [png()] }))).toHaveLength(1);
  });

  it('не дублирует файл, пришедший и в items, и в files', () => {
    // Браузеры кладут одно и то же в оба места; без дедупа картинка вставилась
    // бы дважды и загрузилась дважды.
    const f = png();
    expect(imageFilesFrom(dt({ items: [{ kind: 'file', type: 'image/png', file: f }], files: [f] }))).toHaveLength(1);
  });

  it('не-картинки игнорируются', () => {
    // Перетаскивание pdf или текста обязано остаться обычным поведением
    // редактора, а не уходить в загрузку молча.
    const pdf = ({ name: 'd.pdf', size: 1, type: 'application/pdf' }) as File;
    expect(imageFilesFrom(dt({ files: [pdf] }))).toEqual([]);
    expect(imageFilesFrom(dt({ items: [{ kind: 'string', type: 'text/plain' }] }))).toEqual([]);
  });

  it('пустое событие — пустой список, а не падение', () => {
    expect(imageFilesFrom(null)).toEqual([]);
    expect(imageFilesFrom(undefined)).toEqual([]);
    expect(imageFilesFrom(dt({}))).toEqual([]);
  });

  it('несколько картинок сохраняют порядок, в котором их бросили', () => {
    const a = png('a.png'), b = png('b.png');
    expect(imageFilesFrom(dt({ files: [a, b] })).map(f => f.name)).toEqual(['a.png', 'b.png']);
  });
});
