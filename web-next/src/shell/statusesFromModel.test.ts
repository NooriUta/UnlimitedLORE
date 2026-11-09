// Словарь статусов приходит из модели, а не живёт в клиенте
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-STATUS-AXIS-CONFIG; вопрос владелицы 09.11).
//
// Её слова: «зачем тебе словарь статусов на своей стороне, если это задача уже
// конкретного приложения… я думала, для этого отдельный элемент модели будет,
// типа справочники статусов и workflow по объектам, присылать в kit».
//
// Элемент модели существует, и он богаче, чем я думал. Форма сверена по коду
// сервера (`LoreModel.statusEntry`), а не по переписке: у каждой статьи
// `{code, title, title_en, icon, color, order, category, allow, in_dictionary,
// in_lifecycle, active}`, причём **цвет приходит токеном** (`var(--wrn)`), а не
// hex, и `icon`/`color` МОГУТ БЫТЬ null — когда статуса нет в справочнике.
//
// Что из этого следует для перевода:
//   • вид статуса (цвет, значок, порядок, подпись) больше не рукописный;
//   • `allow` из модели — правило ТИПА; ограничения конкретной записи
//     по-прежнему приходят в `perms.status_next` паспорта, и это не конфликт:
//     тип говорит, что бывает, запись — что можно сейчас;
//   • **null не выдумываем.** Нет цвета — берём нейтральный токен и помечаем
//     это предупреждением, а не подставляем «похожий»: выдуманный цвет статуса
//     врёт о его смысле (сравните «готово» зелёным и «готово» серым).
import { describe, expect, it } from 'vitest';
import { statusesFromModel } from './statusesFromModel';

/** Ответ модели в форме сервера (срезано до нужного). */
const model = (entries: unknown[]) => ({
  statuses: { task_status: { dict: 'task_status', allow_scope: 'type', lifecycle_known: true, entries } },
});

const entry = (over: Record<string, unknown> = {}) => ({
  code: 'active', title: 'В работе', title_en: 'In progress',
  icon: 'wave-crest', color: 'var(--inf)', order: 50,
  category: 'in_progress', allow: ['done', 'blocked'],
  in_dictionary: true, in_lifecycle: true, active: true,
  ...over,
});

describe('S4-STATUS-AXIS-CONFIG · словарь статусов из модели', () => {
  it('положительный контроль: статья модели становится статьёй конфига', () => {
    const r = statusesFromModel(model([entry()]), 'task_status');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ code: 'active', title: 'В работе', icon: 'wave-crest', color: 'var(--inf)' });
  });

  it('переходы берутся из allow — это правило типа', () => {
    const r = statusesFromModel(model([entry()]), 'task_status');
    expect(r.items[0].allow).toEqual(['done', 'blocked']);
  });

  it('порядок статей — по order модели, а не по тому, как они легли в ответ', () => {
    const r = statusesFromModel(model([
      entry({ code: 'done', order: 90 }),
      entry({ code: 'todo', order: 10 }),
      entry({ code: 'active', order: 50 }),
    ]), 'task_status');
    expect(r.items.map(i => i.code)).toEqual(['todo', 'active', 'done']);
  });

  it('цвета нет — нейтральный токен и ПРЕДУПРЕЖДЕНИЕ, а не похожий цвет', () => {
    const r = statusesFromModel(model([entry({ color: null })]), 'task_status');
    expect(r.items[0].color).toBe('var(--t3)');
    expect(r.warnings.join(' ')).toMatch(/цвет/i);
    expect(r.warnings.join(' ')).toContain('active');
  });

  it('значка нет — общий значок и предупреждение: выдумывать смысл нельзя', () => {
    const r = statusesFromModel(model([entry({ icon: null })]), 'task_status');
    expect(r.items[0].icon).toBeTruthy();
    expect(r.warnings.join(' ')).toMatch(/значок|иконк/i);
  });

  it('статус вне справочника не прячется: он есть в данных, значит виден', () => {
    const r = statusesFromModel(model([entry({ code: 'странный', in_dictionary: false, color: null, icon: null })]), 'task_status');
    expect(r.items.map(i => i.code)).toContain('странный');
  });

  it('раздела statuses в модели нет — пустой словарь и честная причина, а не молчание', () => {
    const r = statusesFromModel({}, 'task_status');
    expect(r.items).toEqual([]);
    expect(r.warnings.join(' ')).toMatch(/нет раздела|не описан/i);
  });

  it('тип не описан — тоже названо словами, и это не то же, что «пусто»', () => {
    const r = statusesFromModel(model([entry()]), 'adr_status');
    expect(r.items).toEqual([]);
    expect(r.warnings.join(' ')).toContain('adr_status');
  });

  it('мусор вместо статьи пропускается с причиной, а не роняет экран', () => {
    const r = statusesFromModel(model([entry(), { нет: 'кода' }]), 'task_status');
    expect(r.items).toHaveLength(1);
    expect(r.warnings.join(' ')).toMatch(/без кода/i);
  });

  it('сырой цвет из модели не пропускается: правило «только токенами» держится', () => {
    const r = statusesFromModel(model([entry({ color: '#ff0000' })]), 'task_status');
    expect(r.items[0].color).toBe('var(--t3)');
    expect(r.warnings.join(' ')).toMatch(/токен/i);
  });
});
