// «+ Новая» по всем типам на стенде (SPRINT_LORE_ADMIN_POLISH/AP-06). Чистые функции —
// проверяются vitest-ом (src/standSmoke/createCoverage.test.ts); сценарий — e2e/stand/create.stand.ts.
//
// Путь создания у типа — форма «+ Новая» в v2 (CREATE_TYPES приложения). Тип модели без формы —
// отдельный список отчёта: человек создать его в v2 не может, только MCP.
//
// Запись на стенде не делается (writeGuard.ts: стенд и прод — только чтение; пути удаления записей
// в UI нет — AP-01). Поэтому ячейка «тип × учётка» проверяет право, кнопку, форму и валидацию
// пустого черновика — без сохранения.
import type { Outcome } from './summary.ts';

/**
 * Типы с формой «+ Новая» — копия CREATE_TYPES (src/record/recordCreate.ts). Копия, а не импорт: сценарий
 * стенда грузится в Node, а recordCreate тянет модули приложения (вход, i18n). Совпадение сторожит vitest.
 */
// AP-PASSPORT-EDIT, волна 1: продуктовый слой — боль, выгода, работа, роль, фича.
export const STAND_CREATE_TYPES = ['sprint', 'adr', 'task', 'decision', 'spec', 'organization',
  'pain', 'gain', 'job', 'actor', 'feature'] as const;

export interface CreateCoverage {
  /** Типы модели, у которых в v2 есть форма «+ Новая». */
  withPath: string[];
  /** Типы модели без формы — создать человеком в v2 нельзя. */
  withoutPath: string[];
  /** Блок create модели есть, а формы в приложении нет — расхождение модели и UI. */
  modelOnly: string[];
}

/** Разложить типы модели (/lore/model → types, create) по наличию пути создания в v2. */
export function createCoverage(modelTypes: readonly string[], uiCreateTypes: readonly string[], modelCreate: readonly string[] = []): CreateCoverage {
  const types = [...new Set(modelTypes)].sort();
  const ui = new Set(uiCreateTypes);
  return {
    withPath: types.filter(t => ui.has(t)),
    withoutPath: types.filter(t => !ui.has(t)),
    modelOnly: [...new Set(modelCreate)].filter(t => !ui.has(t)).sort(),
  };
}

/** Типы из ответа /lore/model: поле types — массив {type} или словарь по типу. */
export function modelTypesOf(model: unknown): { types: string[]; create: string[] } {
  const m = (model && typeof model === 'object' ? model : {}) as { types?: unknown; create?: unknown };
  let types: string[] = [];
  if (Array.isArray(m.types)) types = m.types.map(t => (t && typeof t === 'object' ? (t as { type?: unknown }).type : null)).filter((t): t is string => typeof t === 'string');
  else if (m.types && typeof m.types === 'object') types = Object.keys(m.types);
  const create = m.create && typeof m.create === 'object' && !Array.isArray(m.create) ? Object.keys(m.create) : [];
  return { types, create };
}

/** Что сценарий увидел под одной учёткой для одного типа. */
export interface CreateProbe {
  account: string;
  /** seer_role учётки из whoami (superadmin / admin / viewer / …); null — не узнали. */
  seerRole: string | null;
  /** HTTP-код GET /lore/record/<тип>/_new; null — запрос не дошёл. */
  permStatus: number | null;
  /** perms.can_create паспорта _new. */
  canCreate: boolean;
  /** Причина отказа сервера словами (perms.reason). */
  permReason?: string | null;
  /** Кнопка «+ Новая» в списке раздела видна. */
  buttonVisible: boolean;
  /** Форма черновика открылась по кнопке (только когда право есть). */
  formOpened?: boolean;
  /** «Сохранить» у пустого черновика заблокировано. */
  saveBlocked?: boolean;
  /** Текст причины блокировки («Не заполнено: …»). */
  whyText?: string;
}

export interface CreateCell { account: string; outcome: Outcome; reason: string }

/** Исход ячейки «тип × учётка». */
export function judgeCreateCell(p: CreateProbe): CreateCell {
  const cell = (outcome: Outcome, reason: string): CreateCell => ({ account: p.account, outcome, reason });
  if (p.permStatus === null) return cell('not-run', 'право создать не узнали — запрос к /_new не дошёл');
  if (p.permStatus !== 200) return cell('not-run', `право создать не узнали — /_new ответил ${p.permStatus}`);
  if (p.canCreate !== p.buttonVisible) {
    return cell('fail', p.canCreate ? 'сервер разрешает создать, а кнопки «+ Новая» нет' : 'кнопка «+ Новая» видна, а сервер создавать не разрешает');
  }
  if (p.seerRole === 'viewer' && p.canCreate) return cell('fail', 'viewer может создавать — гейт роли открыт');
  if (!p.canCreate) return cell('pass', `кнопки нет, право закрыто${p.permReason ? `: ${p.permReason}` : ''}`);
  if (!p.formOpened) return cell('fail', 'по кнопке «+ Новая» форма черновика не открылась');
  if (!p.saveBlocked) return cell('fail', 'пустой черновик можно сохранить — обязательные поля не держат «Сохранить»');
  if (!p.whyText?.trim()) return cell('fail', '«Сохранить» заблокировано молча — причина не названа');
  return cell('pass', `форма открылась, пустой черновик не сохраняется: ${p.whyText.trim()}`);
}

/**
 * Итог типа по ячейкам: хоть один FAIL — fail; все «не применимо» — n/a (среда не та, проверять нечего);
 * ни одной выполненной — not-run; иначе pass. «Не применимо» вперемешку с «не выполнено» — not-run:
 * выполненного всё равно нет (1.18.3, итог n/a общий с отчётом смоука).
 */
export function typeOutcome(cells: readonly CreateCell[]): Outcome {
  if (cells.some(c => c.outcome === 'fail')) return 'fail';
  if (cells.length > 0 && cells.every(c => c.outcome === 'n/a')) return 'n/a';
  if (cells.every(c => c.outcome === 'not-run' || c.outcome === 'n/a')) return 'not-run';
  return 'pass';
}

/** Строка отчёта по типу: «учётка — PASS/FAIL/НЕ ВЫПОЛНЕН/НЕ ПРИМЕНИМО: причина» через «; ». */
export function renderCells(cells: readonly CreateCell[]): string {
  const word: Record<Outcome, string> = { pass: 'PASS', fail: 'FAIL', 'not-run': 'НЕ ВЫПОЛНЕН', 'n/a': 'НЕ ПРИМЕНИМО' };
  return cells.map(c => `${c.account} — ${word[c.outcome]}: ${c.reason}`).join('; ');
}
