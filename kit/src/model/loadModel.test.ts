// SPRINT_UXR_S10_SEIDR_KIT/K-MODEL-LOADER — загрузчик модели.
//
// ADR-LORE-048. Решения, которые здесь закрепляются:
//   • модель обязательна как форма, но не наш сервер: источник подключаемый
//     (D-2026-LORE-MODEL-PLUGGABLE-SOURCE) — загрузчик принимает добытчика,
//     а не адрес, поэтому годится и файл рядом с прототипом;
//   • сторож «данные не пробивают поведение» применяется к ЛЮБОМУ источнику;
//   • версия лежит внутри документа, а не только в заголовке ответа: у файла
//     заголовков нет;
//   • «раздела нет» и «раздел пуст» — разные вещи (partial / missing);
//   • кеш виден: устаревшую модель можно взять в работу, но видно, что она
//     устаревшая.
import { describe, expect, it, vi } from 'vitest';
import { loadModel, modelSections, parseModel, readCachedModel, writeCachedModel } from './loadModel';

const DOC = {
  format: 'model/0',
  version: 'abc123',
  partial: true,
  missing: ['types', 'surfaces'],
  statuses_known: ['task', 'sprint'],
  statuses: {
    task: {
      dict: 'task_status',
      entries: [
        { code: 'done', title: 'Готово', title_en: 'Done', icon: 'divided-spiral', color: '#7dbf78', order: 5, category: 'finished', allow: ['active'], active: true },
      ],
    },
  },
  dictionaries: {
    work_class: [{ code: 'enb', title: 'Enabler', icon: null, color: '#9A8CDB', order: 30, active: true }],
  },
  warnings: ['task_status: статус «foo» есть в цикле, но нет в справочнике'],
};

describe('K-MODEL-LOADER · разбор документа', () => {
  it('читает версию и разделы из самого документа', () => {
    const m = parseModel(DOC);
    expect(m.version).toBe('abc123');
    expect(m.format).toBe('model/0');
    expect(m.partial).toBe(true);
    expect(m.missing).toEqual(['types', 'surfaces']);
  });

  it('«раздела нет» и «раздел пуст» — разные ответы', () => {
    const m = parseModel(DOC);
    expect(modelSections(m).types).toBe('missing');
    expect(modelSections(m).statuses).toBe('present');
    // Справочники есть, но типов в них может не быть — это «есть и пусто».
    expect(modelSections(parseModel({ ...DOC, dictionaries: {} })).dictionaries).toBe('empty');
  });

  it('чужой формат — отказ с названием формата, а не тихое «пусто»', () => {
    expect(() => parseModel({ ...DOC, format: 'model/99' })).toThrow(/model\/99/);
    expect(() => parseModel({ version: 'x' })).toThrow(/format/i);
  });

  it('версии нет — отказ: без версии не работают ни кеш, ни скос версий', () => {
    const { version: _v, ...noVersion } = DOC;
    expect(() => parseModel(noVersion)).toThrow(/версия|version/i);
  });

  it('поведение внутри модели — отказ с точным путём, тем же сторожем', () => {
    const bad = { ...DOC, statuses: { task: { verdict: () => 1 } } };
    expect(() => parseModel(bad)).toThrow(/statuses\.task\.verdict/);
  });

  it('предупреждения — текст для человека, их не разбираем', () => {
    expect(parseModel(DOC).warnings).toHaveLength(1);
  });
});

describe('K-MODEL-LOADER · источник подключаемый', () => {
  it('берёт документ у добытчика, не зная ни адреса, ни токена', async () => {
    const fetchModel = vi.fn(async () => DOC);
    const res = await loadModel(fetchModel);
    expect(res.state).toBe('ok');
    expect(res.model?.version).toBe('abc123');
    expect(fetchModel).toHaveBeenCalledOnce();
  });

  it('статический файл — такой же источник, как сервер', async () => {
    const res = await loadModel(async () => JSON.parse(JSON.stringify(DOC)));
    expect(res.state).toBe('ok');
  });

  it('сбой источника — честная ошибка, а не «модель пуста»', async () => {
    const res = await loadModel(async () => { throw new Error('503'); });
    expect(res.state).toBe('error');
    expect(res.model).toBeUndefined();
  });

  it('негодный документ — тоже ошибка, и причина названа', async () => {
    const res = await loadModel(async () => ({ format: 'model/0' }));
    expect(res.state).toBe('error');
    expect(String(res.error)).toMatch(/версия|version/i);
  });
});

describe('K-MODEL-LOADER · кеш виден', () => {
  function mem() {
    const m = new Map<string, string>();
    return { get: (k: string) => m.get(k) ?? null, set: (k: string, v: string) => { m.set(k, v); } };
  }

  it('кладём и читаем по версии', () => {
    const s = mem();
    writeCachedModel(s, parseModel(DOC));
    expect(readCachedModel(s)?.version).toBe('abc123');
  });

  it('битый кеш — ничего, а не падение: работаем без него', () => {
    const s = mem();
    s.set('kit.model.doc', '{не json');
    expect(readCachedModel(s)).toBeUndefined();
  });

  it('источник упал, но кеш есть — отдаём кеш и помечаем устаревшим', async () => {
    const s = mem();
    writeCachedModel(s, parseModel(DOC));
    const res = await loadModel(async () => { throw new Error('нет сети'); }, { store: s });
    expect(res.state).toBe('stale');
    expect(res.model?.version).toBe('abc123');
    // Молчащего кеша не бывает: причина, по которой он устарел, названа.
    expect(res.error).toBeDefined();
  });

  it('источник ответил — кеш обновляется', async () => {
    const s = mem();
    writeCachedModel(s, parseModel(DOC));
    await loadModel(async () => ({ ...DOC, version: 'def456' }), { store: s });
    expect(readCachedModel(s)?.version).toBe('def456');
  });
});
