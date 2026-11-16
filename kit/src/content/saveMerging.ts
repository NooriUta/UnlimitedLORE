// Сохранение MD-поля паспорта со слиянием по блокам (SPRINT_UXR_S5_RECORD_TASKS/S5-08).
//
// Версия при сохранении уже уходит (passportSave, `expected_version`), и сервер
// отказывает 409-м, если запись изменили после чтения. Раньше на этом всё
// кончалось: «перечитайте и повторите», а правку человек переносил руками.
// Теперь: перечитываем запись и сливаем три текста поля по блокам (kit
// `mergeBlocks`). Правили разные блоки — записываем слитое с НОВОЙ версией,
// человек ничего не замечает и ничего не теряет. Правили один блок по-разному —
// отказ `MdMergeConflict` со спорными блоками; поле правки kit покажет
// построчный дифф только по ним.
//
// Перенесено из web-next в kit (SPRINT_UXR_S14_KIT5/K5-PASSPORT-FROM-MODEL, шаг 4). От приложения
// kit знает только форму отказа: ошибка с именем «VersionConflict» и полем updatedBy (так её
// называет LORE, passportSave). Своё имя — функция conflictOf.
import { MdMergeConflict, mergeBlocks } from './blockMerge';

/** Отказ «версия разошлась»: имя ошибки VersionConflict, кто правил — если сервер назвал. */
export function versionConflictOf(e: unknown): { updatedBy: string | null } | null {
  if (!(e instanceof Error) || e.name !== 'VersionConflict') return null;
  const who = (e as { updatedBy?: unknown }).updatedBy;
  return { updatedBy: typeof who === 'string' ? who : null };
}

export interface MdFieldState { text: string; version: string | null }

export interface SaveMergingArgs {
  /** Текст поля, поверх которого человек правил (база слияния). */
  base: string;
  /** Набранное человеком. */
  mine: string;
  /** Версия записи, с которой читали базу. */
  version: string | null;
  /** Записать текст с версией; расхождение — ошибка VersionConflict (см. conflictOf). */
  save: (text: string, version: string | null) => Promise<void>;
  /** Перечитать поле и версию записи сейчас. */
  reread: () => Promise<MdFieldState>;
  /**
   * Перечитали — новая база и версия для СЛЕДУЮЩЕГО сохранения. Без этого
   * человек решил спор, нажал «Сохранить» — и снова получил 409 со старой версией.
   */
  rebase?: (fresh: MdFieldState) => void;
  /** Распознать отказ «версия разошлась»; по умолчанию — versionConflictOf. */
  conflictOf?: (e: unknown) => { updatedBy: string | null } | null;
}

/** Сколько раз подряд перечитываем и сливаем, если запись правят прямо сейчас. */
const ATTEMPTS = 3;

export async function saveMerging({ base, mine, version, save, reread, rebase, conflictOf = versionConflictOf }: SaveMergingArgs): Promise<void> {
  let from = base;
  let ver = version;
  let text = mine;
  for (let attempt = 1; ; attempt++) {
    try {
      await save(text, ver);
      return;
    } catch (e) {
      const conflict = conflictOf(e);
      if (!conflict || attempt >= ATTEMPTS) throw e;
      const fresh = await reread();
      rebase?.(fresh);
      const merged = mergeBlocks(from, mine, fresh.text);
      if (merged.text === null) throw new MdMergeConflict(merged.chunks, conflict.updatedBy);
      from = fresh.text;
      ver = fresh.version;
      // Слитое уже содержит мои правки; следующий круг сливает его поверх новой базы.
      text = merged.text;
      mine = merged.text;
    }
  }
}
