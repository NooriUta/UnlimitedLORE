// Палитры приходят ДАННЫМИ из модели (SPRINT_UXR_S10_SEIDR_KIT/K-14, п. 5).
//
// Повод — слова владелицы 09.11.2026: «зачем тебе словарь статусов на своей
// стороне, если это задача уже конкретного приложения» и «завтра кто-нибудь
// будет на kit собирать своё приложение и?». Список палитр внутри kit — такой
// же прикладной словарь, как список статусов.
//
// Форму прислала серверная сессия (PR #1069), и я её НЕ угадывал:
//   palettes: {source, default, entries: [{code, title, title_en, order, in_dictionary}]}
// Коды и умолчание — из того же белого списка, что принимает настройка
// `palette`: модель не предложит палитру, которую сервер не даст сохранить.
//
// Что здесь закреплено жёстче всего — три РАЗНЫХ «нет»:
//  • раздела не прислали (старый сервер) — показываем список kit и ГОВОРИМ, что
//    это умолчание, а не выбор модели;
//  • палитра есть, а статьи в справочнике нет (`in_dictionary: false`) —
//    показываем код и говорим, что подписи нет;
//  • палитра есть в модели, а цветов её в теме kit нет — говорим и это, потому
//    что образец нарисовать нечем.
import { describe, expect, it } from 'vitest';
import { palettesFromModel } from './palettes';

const model = (over: Record<string, unknown> = {}) => ({
  palettes: {
    source: 'settings:palette',
    default: 'amber-forest',
    entries: [
      { code: 'lichen', title: 'Лишайник', title_en: 'Lichen', order: 2, in_dictionary: true },
      { code: 'amber-forest', title: 'Янтарный лес', title_en: 'Amber forest', order: 1, in_dictionary: true },
    ],
  },
  ...over,
});

describe('K-14 · палитры из модели', () => {
  it('положительный контроль: раздел прочитан, умолчание и источник на месте', () => {
    const p = palettesFromModel(model());
    expect(p.sent).toBe(true);
    expect(p.default).toBe('amber-forest');
    expect(p.source).toBe('settings:palette');
  });

  it('порядок — по order, а не по порядку в ответе', () => {
    expect(palettesFromModel(model()).entries.map(e => e.code)).toEqual(['amber-forest', 'lichen']);
  });

  it('order не прислали — порядок по коду, лишь бы он был устойчивым', () => {
    const p = palettesFromModel(model({
      palettes: { entries: [{ code: 'slate', in_dictionary: true, title: 'Slate' }, { code: 'juniper', in_dictionary: true, title: 'Juniper' }] },
    }));
    expect(p.entries.map(e => e.code)).toEqual(['juniper', 'slate']);
  });

  it('подписи нет в справочнике — показан КОД и сказано, что подписи нет', () => {
    const p = palettesFromModel(model({
      palettes: { default: 'slate', entries: [{ code: 'slate', title: '', in_dictionary: false }] },
    }));
    expect(p.entries[0].title).toBe('slate');
    expect(p.entries[0].inDictionary).toBe(false);
    expect(p.notes.join(' ')).toMatch(/справочник/i);
    expect(p.notes.join(' ')).toContain('slate');
  });

  it('en-подпись доносится отдельно: язык выбирает приложение', () => {
    expect(palettesFromModel(model()).entries[0].titleEn).toBe('Amber forest');
  });

  it('раздела нет вовсе — это СКАЗАНО, список пуст, и умолчание не выдумано', () => {
    const p = palettesFromModel({});
    expect(p.sent).toBe(false);
    expect(p.entries).toEqual([]);
    expect(p.default).toBeNull();
    expect(p.notes.join(' ')).toMatch(/не прислал/i);
  });

  // Загрузчик нормализует отсутствующий раздел в пустой объект — для нас это
  // по-прежнему «не прислали», иначе старый сервер получит жалобу о мусоре.
  it('загрузчик отдал пустой объект вместо раздела — это «не прислали»', () => {
    const p = palettesFromModel({ palettes: {} });
    expect(p.sent).toBe(false);
    expect(p.notes.join(' ')).toMatch(/не прислал/i);
  });

  it('раздел назван в missing — то же самое: не прислали', () => {
    const p = palettesFromModel({ missing: ['palettes'] });
    expect(p.sent).toBe(false);
    expect(p.notes.join(' ')).toMatch(/не прислал/i);
  });

  it('раздел пришёл пустым списком — это НЕ «не прислали», и текст другой', () => {
    const p = palettesFromModel({ palettes: { entries: [], default: null } });
    expect(p.sent).toBe(true);
    expect(p.entries).toEqual([]);
    expect(p.notes.join(' ')).toMatch(/пуст/i);
  });

  it('палитра модели, цветов которой нет в теме kit — названа, образца у неё нет', () => {
    const p = palettesFromModel(
      model({ palettes: { default: 'amber-forest', entries: [{ code: 'neon', title: 'Неон', in_dictionary: true }] } }),
      { known: ['amber-forest', 'lichen'] },
    );
    expect(p.entries[0].swatch).toBeNull();
    expect(p.notes.join(' ')).toMatch(/тем/i);
    expect(p.notes.join(' ')).toContain('neon');
  });

  it('известная палитра получает образец токеном, а не цветом: значения живут в теме', () => {
    const p = palettesFromModel(model(), { known: ['amber-forest', 'lichen'] });
    expect(p.entries[0].swatch).toBe('var(--swatch-amber-forest)');
  });

  it('умолчание, которого нет в списке — сказано: иначе панель покажет пустой выбор', () => {
    const p = palettesFromModel(model({
      palettes: { default: 'нетакой', entries: [{ code: 'slate', title: 'Slate', in_dictionary: true }] },
    }));
    expect(p.default).toBe('нетакой');
    expect(p.notes.join(' ')).toMatch(/умолчан/i);
  });

  it('мусор вместо раздела не ломает разбор и не притворяется данными', () => {
    for (const bad of [null, 'строка', 42, { palettes: 'да' }, { palettes: { entries: 'нет' } }]) {
      const p = palettesFromModel(bad);
      expect(p.entries).toEqual([]);
      expect(p.notes.length).toBeGreaterThan(0);
    }
  });

  it('строка без кода отбрасывается — пустой пункт выбора хуже отсутствующего', () => {
    const p = palettesFromModel(model({
      palettes: { entries: [{ code: '', title: 'Безымянная', in_dictionary: true }, { code: 'slate', title: 'Slate', in_dictionary: true }] },
    }));
    expect(p.entries.map(e => e.code)).toEqual(['slate']);
  });

  it('разбор детерминирован: тот же ответ — тот же результат', () => {
    expect(palettesFromModel(model())).toEqual(palettesFromModel(model()));
  });
});

// Проверка 11.11.2026: оговорки kit — локалью kit, а не русским текстом в коде.
describe('K-14 · оговорки о палитрах — на языке интерфейса', () => {
  it('lang=en — оговорка по-английски', async () => {
    const { palettesFromModel } = await import('./palettes');
    const p = palettesFromModel({}, { lang: 'en' });
    expect(p.notes[0]).not.toMatch(/[А-Яа-яЁё]/);
    expect(p.notes[0].length).toBeGreaterThan(0);
  });
  it('по умолчанию — по-русски, как было', async () => {
    const { palettesFromModel } = await import('./palettes');
    expect(palettesFromModel({}).notes[0]).toMatch(/палитр/);
  });
});
