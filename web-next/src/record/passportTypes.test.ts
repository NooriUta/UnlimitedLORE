// Паспорт есть ровно у тех типов, что отдаёт фасад — и перечень не врёт
// (SPRINT_UXR_S4_UI_SHELL_LISTS/S4-V2-SECTIONS).
//
// Два разных обещания, и каждое однажды нарушалось в этом проекте:
//
//  1. **Карта разделов не обещает лишнего.** Пока она была ПОЛНОЙ по экранам,
//     щелчок по строке в разделе без паспорта открывал пустую карточку, и это
//     читалось как «данные потерялись». Теперь карта частичная, и разделы без
//     паспорта отвечают словами (`pages/noPassport.test.tsx`).
//  2. **Перечень записей для стрелок «предыдущая / следующая» знает свой тип.**
//     У `listOf` была ветка по умолчанию на задачи: новый тип без своей ветки
//     молча водил бы стрелками по ЧУЖИМ записям. Это хуже отсутствия стрелок.
import { describe, expect, it, vi } from 'vitest';
import { PASSPORT_TYPES, listOf, type PassportType } from './passportAdapters';
import { LIST_SCREENS } from '../lists/screens';

describe('типы с паспортом', () => {
  it('положительный контроль: перечень непустой и содержит спринт', () => {
    expect(PASSPORT_TYPES.length).toBeGreaterThan(0);
    expect(PASSPORT_TYPES).toContain('sprint');
  });

  /**
   * Одиннадцать типов — ровно `LoreRecordRegistry.TYPES` сервера на 10.11
   * (после release идут component, tech, feature; серверный PR #1090). Список
   * явный намеренно: он растёт вместе с фасадом, и этот тест — то место, где
   * видно расхождение с сервером.
   */
  it('перечень совпадает с типами фасада', () => {
    expect([...PASSPORT_TYPES]).toEqual([
      'sprint', 'task', 'adr', 'spec', 'doc', 'decision', 'question', 'milestone', 'release',
      'component', 'tech', 'feature', 'product', 'user', 'agent', 'project',
    ]);
  });

  it('у каждого типа паспорта есть свой перечень записей — ни один не падает на задачи', async () => {
    // Подставной срез: возвращает имя слайса, по которому его позвали.
    const seen: string[] = [];
    const slice = vi.fn(async (name: string) => {
      seen.push(name);
      return { rows: [] };
    }) as never;

    for (const type of PASSPORT_TYPES) {
      seen.length = 0;
      await listOf(type as PassportType, slice);
      expect(seen, `тип «${type}» не выбрал свой срез`).toHaveLength(1);
      // Ветка по умолчанию — задачи. Любой НЕ-задачный тип, попавший в неё,
      // получил бы чужой перечень.
      if (type !== 'task') {
        expect(seen[0], `тип «${type}» упал в ветку задач`).not.toBe('open_tasks');
      }
    }
  });

  it('каждый тип берёт свой срез — перечень явный, а не угаданный', async () => {
    const calls: { type: string; slice: string }[] = [];
    const slice = vi.fn(async (name: string) => {
      calls.push({ type: '', slice: name });
      return { rows: [] };
    }) as never;
    const sliceOf = async (type: PassportType) => {
      calls.length = 0;
      await listOf(type, slice);
      return calls[0].slice;
    };
    expect(await sliceOf('decision')).toBe('decisions');
    expect(await sliceOf('question')).toBe('questions');
    expect(await sliceOf('milestone')).toBe('milestones');
    expect(await sliceOf('release')).toBe('releases');
    // S4-29 (53а): паспорт проекта — перечень проектов из того же среза, что выбор проекта.
    expect(await sliceOf('project')).toBe('git_projects');
  });

  it('вехи: название берётся из label, а не из title', async () => {
    const slice = (async () => ({ rows: [{ milestone_id: 'M-1', label: 'O1 · клиент' }] })) as never;
    expect(await listOf('milestone', slice)).toEqual([{ id: 'M-1', title: 'O1 · клиент' }]);
  });

  it('релизы: код — release_uid, а не повторяющийся тег', async () => {
    const slice = (async () => ({ rows: [{ release_uid: 'NooriUta/UnlimitedLORE#v1.17.4', git_tag: 'v1.17.4' }] })) as never;
    expect(await listOf('release', slice)).toEqual([
      { id: 'NooriUta/UnlimitedLORE#v1.17.4', title: 'v1.17.4' },
    ]);
  });

  it('название пустое — вместо него код, а не пустая строка в стрелках', async () => {
    const slice = (async () => ({ rows: [{ decision_id: 'D-1', title: '' }] })) as never;
    expect(await listOf('decision', slice)).toEqual([{ id: 'D-1', title: 'D-1' }]);
  });

  // 09.11 здесь стояло обратное утверждение: «component, tech и feature в
  // типах паспорта быть НЕ должно — фасад их не отдаёт». 10.11 фасад начал
  // их отдавать (серверный PR #1090), и утверждение стало неправдой. Снимать
  // проверку целиком нельзя: она держала правило «не обещать паспорт типу,
  // которого нет у сервера». Поэтому правило осталось, а список типов,
  // которых ждём, переехал в проверку выше — там он сверяется с фасадом.
  it('раздел не ведёт на тип, которого нет в перечне фасада', () => {
    const screens = Object.keys(LIST_SCREENS);
    expect(screens).toContain('tech');
    expect(screens).toContain('components');
    expect(screens).toContain('features');
    // Обещать паспорт можно ровно тем типам, что перечислены в PASSPORT_TYPES:
    // лишнее обещание даёт пустую карточку, и человек читает её как потерю.
    for (const t of ['tech', 'component', 'feature']) {
      expect([...PASSPORT_TYPES], `${t} нет в перечне фасада`).toContain(t);
    }
  });
});
